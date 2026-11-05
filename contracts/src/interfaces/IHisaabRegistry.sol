// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

enum Status {
    Open,
    PartiallyPaid,
    Paid,
    Cancelled,
    Refunded
}

struct Invoice {
    address issuer;
    address client;
    address payer;
    uint128 amount;
    uint128 paid;
    uint128 refunded;
    uint64 createdAt;
    uint64 dueDate;
    uint64 paidAt;
    Status status;
    bytes32 docHash;
    bytes32 issuerNode;
    uint256 supersedes;
    string issuerName;
    string clientName;
}

struct CreateParams {
    address client;
    uint128 amount;
    uint64 dueDate;
    bytes32 docHash;
    bytes32 issuerNode;
    string issuerName;
    string clientName;
    uint256 supersedes;
}

interface IHisaabRegistry {
    event InvoiceCreated(
        uint256 indexed id,
        address indexed issuer,
        address indexed client,
        uint128 amount,
        uint64 dueDate,
        bytes32 docHash,
        uint256 supersedes
    );
    event Paid(uint256 indexed id, address indexed payer, uint128 amount, uint128 totalPaid, bool gasless);
    event Settled(uint256 indexed id, uint256 receiptId);
    event Refunded(uint256 indexed id, address indexed to, uint128 amount, uint128 totalRefunded);
    event Cancelled(uint256 indexed id, address indexed by);

    error ZeroAmount();
    error BadDueDate();
    error NoDocHash();
    error NameTooLong();
    error BadSupersede();
    error NotPayable();
    error NotClient();
    error WrongPayer();
    error Overpay();
    error NotRefundable();
    error OverRefund();
    error NotCancellable();
    error NotIssuer();
    error NotParty();
    error InvoiceNotFound();
    error BadReceipt();

    function createInvoice(CreateParams calldata p) external returns (uint256 id);

    function pay(uint256 id, uint128 amount) external;

    function payWithAuthorization(
        uint256 id,
        address from,
        uint128 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        bytes calldata signature
    ) external;

    function refund(uint256 id, uint128 amount) external;

    function cancel(uint256 id) external;

    function getInvoice(uint256 id) external view returns (Invoice memory);

    function isOverdue(uint256 id) external view returns (bool);

    function nextId() external view returns (uint256);
}
