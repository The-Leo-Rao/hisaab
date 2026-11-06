// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IHisaabRegistry, Invoice, CreateParams, Status} from "./interfaces/IHisaabRegistry.sol";
import {IEIP3009} from "./interfaces/IEIP3009.sol";
import {HisaabReceipt} from "./HisaabReceipt.sol";

contract HisaabRegistry is IHisaabRegistry, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_NAME_BYTES = 64;

    IERC20 public immutable usdt;
    HisaabReceipt public immutable receipt;

    uint256 public nextId = 1;

    mapping(uint256 => Invoice) private _invoices;
    mapping(uint256 => uint256) public supersededBy;

    constructor(IERC20 usdt_, HisaabReceipt receipt_) {
        if (receipt_.registry() != address(this)) revert BadReceipt();
        usdt = usdt_;
        receipt = receipt_;
    }

    function createInvoice(CreateParams calldata p) external nonReentrant returns (uint256 id) {
        if (p.amount == 0) revert ZeroAmount();
        if (p.dueDate <= block.timestamp) revert BadDueDate();
        if (p.docHash == bytes32(0)) revert NoDocHash();
        if (bytes(p.issuerName).length > MAX_NAME_BYTES || bytes(p.clientName).length > MAX_NAME_BYTES) {
            revert NameTooLong();
        }
        if (p.supersedes != 0) {
            // Refunded is also accepted so an open-link invoice locked by a dust payment can be reissued.
            Invoice storage old = _invoices[p.supersedes];
            bool closed = old.status == Status.Cancelled || old.status == Status.Refunded;
            if (old.issuer != msg.sender || !closed || supersededBy[p.supersedes] != 0) {
                revert BadSupersede();
            }
        }

        id = nextId++;
        Invoice storage inv = _invoices[id];
        inv.issuer = msg.sender;
        inv.client = p.client;
        inv.amount = p.amount;
        inv.createdAt = uint64(block.timestamp);
        inv.dueDate = p.dueDate;
        inv.status = Status.Open;
        inv.docHash = p.docHash;
        inv.issuerNode = p.issuerNode;
        inv.supersedes = p.supersedes;
        inv.issuerName = p.issuerName;
        inv.clientName = p.clientName;
        if (p.supersedes != 0) supersededBy[p.supersedes] = id;

        emit InvoiceCreated(id, msg.sender, p.client, p.amount, p.dueDate, p.docHash, p.supersedes);
    }

    function refund(uint256 id, uint128 amount) external nonReentrant {
        Invoice storage inv = _invoices[id];
        if (inv.issuer == address(0)) revert InvoiceNotFound();
        if (msg.sender != inv.issuer) revert NotIssuer();
        if (inv.status != Status.Paid && inv.status != Status.PartiallyPaid) revert NotRefundable();
        if (amount == 0) revert ZeroAmount();
        uint128 totalRefunded = inv.refunded + amount;
        if (totalRefunded > inv.paid) revert OverRefund();

        inv.refunded = totalRefunded;
        if (totalRefunded == inv.paid) {
            inv.status = Status.Refunded;
            receipt.burnByRegistry(id);
        }
        address payer = inv.payer;
        emit Refunded(id, payer, amount, totalRefunded);

        usdt.safeTransferFrom(msg.sender, payer, amount);
    }

    function cancel(uint256 id) external nonReentrant {
        Invoice storage inv = _invoices[id];
        if (inv.issuer == address(0)) revert InvoiceNotFound();
        if (msg.sender != inv.issuer && (inv.client == address(0) || msg.sender != inv.client)) revert NotParty();
        if (inv.status != Status.Open || inv.paid != 0) revert NotCancellable();

        inv.status = Status.Cancelled;
        emit Cancelled(id, msg.sender);
    }

    function pay(uint256 id, uint128 amount) external nonReentrant {
        address issuer = _recordPayment(id, msg.sender, amount, false);
        usdt.safeTransferFrom(msg.sender, issuer, amount);
    }

    function payWithAuthorization(
        uint256 id,
        address from,
        uint128 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        bytes calldata signature
    ) external nonReentrant {
        bytes32 nonce = authorizationNonce(id, from, amount, salt);
        address issuer = _recordPayment(id, from, amount, true);
        IEIP3009(address(usdt)).receiveWithAuthorization(
            from, address(this), amount, validAfter, validBefore, nonce, signature
        );
        usdt.safeTransfer(issuer, amount);
    }

    function getInvoice(uint256 id) external view returns (Invoice memory) {
        return _invoices[id];
    }

    function isOverdue(uint256 id) external view returns (bool) {
        Invoice storage inv = _invoices[id];
        return inv.issuer != address(0) && inv.refunded == 0 && block.timestamp > inv.dueDate
            && (inv.status == Status.Open || inv.status == Status.PartiallyPaid);
    }

    // The pay page must sign exactly this nonce.
    function authorizationNonce(uint256 id, address from, uint128 amount, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), id, from, amount, salt));
    }

    function _recordPayment(uint256 id, address payer, uint128 amount, bool gasless)
        private
        returns (address issuer)
    {
        Invoice storage inv = _invoices[id];
        issuer = inv.issuer;
        if (issuer == address(0)) revert InvoiceNotFound();
        if (inv.status != Status.Open && inv.status != Status.PartiallyPaid) revert NotPayable();
        if (inv.refunded != 0) revert NotPayable();
        if (inv.client != address(0) && payer != inv.client) revert NotClient();
        if (inv.payer != address(0) && payer != inv.payer) revert WrongPayer();
        if (amount == 0) revert ZeroAmount();
        uint128 totalPaid = inv.paid + amount;
        if (totalPaid > inv.amount) revert Overpay();

        inv.paid = totalPaid;
        if (inv.payer == address(0)) inv.payer = payer;

        if (totalPaid == inv.amount) {
            inv.status = Status.Paid;
            inv.paidAt = uint64(block.timestamp);
            receipt.mint(issuer, id);
            emit Settled(id, id);
        } else {
            inv.status = Status.PartiallyPaid;
        }
        emit Paid(id, payer, amount, totalPaid, gasless);
    }
}
