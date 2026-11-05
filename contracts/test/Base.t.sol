// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HisaabRegistry} from "../src/HisaabRegistry.sol";
import {HisaabReceipt} from "../src/HisaabReceipt.sol";
import {Invoice, CreateParams, Status} from "../src/interfaces/IHisaabRegistry.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";

abstract contract BaseTest is Test {
    HisaabRegistry registry;
    HisaabReceipt receipt;
    MockUSDT usdt;

    string constant VERIFY_BASE = "https://hisaab.vercel.app/verify/";
    uint128 constant AMOUNT = 500e6;
    bytes32 constant DOC = keccak256("canonical-invoice-json");
    string constant ISSUER_NAME = "acme-q4.ravi-dev.eth";
    string constant CLIENT_NAME = "acme-labs.eth";

    address ravi = makeAddr("ravi");
    address acme;
    uint256 acmePk;
    address stranger = makeAddr("stranger");
    address relayer = makeAddr("relayer");
    uint64 dueDate;

    function setUp() public virtual {
        (acme, acmePk) = makeAddrAndKey("acme");
        usdt = new MockUSDT();

        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        receipt = new HisaabReceipt(predicted, VERIFY_BASE);
        registry = new HisaabRegistry(IERC20(address(usdt)), receipt);
        assertEq(address(registry), predicted);

        address[3] memory parties = [ravi, acme, stranger];
        for (uint256 i; i < parties.length; ++i) {
            usdt.mint(parties[i], 10_000e6);
            vm.prank(parties[i]);
            usdt.approve(address(registry), type(uint256).max);
        }
        dueDate = uint64(block.timestamp + 14 days);
    }

    function _params(address client) internal view returns (CreateParams memory p) {
        p.client = client;
        p.amount = AMOUNT;
        p.dueDate = dueDate;
        p.docHash = DOC;
        p.issuerNode = keccak256(bytes(ISSUER_NAME));
        p.issuerName = ISSUER_NAME;
        p.clientName = CLIENT_NAME;
    }

    function _create(address client) internal returns (uint256 id) {
        vm.prank(ravi);
        id = registry.createInvoice(_params(client));
    }

    function _inv(uint256 id) internal view returns (Invoice memory) {
        return registry.getInvoice(id);
    }

    function _status(uint256 id) internal view returns (uint8) {
        return uint8(registry.getInvoice(id).status);
    }

    function _sign(uint256 pk, address from, uint256 id, uint128 amount, bytes32 salt, uint256 validBefore)
        internal
        view
        returns (bytes memory)
    {
        bytes32 nonce = keccak256(abi.encode(block.chainid, address(registry), id, from, amount, salt));
        assertEq(nonce, registry.authorizationNonce(id, from, amount, salt));
        bytes32 structHash = keccak256(
            abi.encode(
                usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, address(registry), amount, 0, validBefore, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
