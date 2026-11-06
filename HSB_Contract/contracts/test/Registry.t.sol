// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseTest} from "./Base.t.sol";
import {HisaabRegistry} from "../src/HisaabRegistry.sol";
import {HisaabReceipt} from "../src/HisaabReceipt.sol";
import {IHisaabRegistry, Invoice, CreateParams, Status} from "../src/interfaces/IHisaabRegistry.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";

contract RegistryTest is BaseTest {
    function test_CreateStoresFields() public {
        CreateParams memory p = _params(acme);
        vm.expectEmit(true, true, true, true, address(registry));
        emit IHisaabRegistry.InvoiceCreated(1, ravi, acme, AMOUNT, dueDate, DOC, 0);
        vm.prank(ravi);
        uint256 id = registry.createInvoice(p);

        assertEq(id, 1);
        assertEq(registry.nextId(), 2);
        Invoice memory inv = _inv(id);
        assertEq(inv.issuer, ravi);
        assertEq(inv.client, acme);
        assertEq(inv.payer, address(0));
        assertEq(inv.amount, AMOUNT);
        assertEq(inv.paid, 0);
        assertEq(inv.refunded, 0);
        assertEq(inv.createdAt, block.timestamp);
        assertEq(inv.dueDate, dueDate);
        assertEq(inv.paidAt, 0);
        assertEq(uint8(inv.status), uint8(Status.Open));
        assertEq(inv.docHash, DOC);
        assertEq(inv.issuerNode, p.issuerNode);
        assertEq(inv.supersedes, 0);
        assertEq(inv.issuerName, ISSUER_NAME);
        assertEq(inv.clientName, CLIENT_NAME);
    }

    function test_RevertCreate_ZeroAmount_PastDue_NoHash_LongName() public {
        CreateParams memory p = _params(acme);
        vm.startPrank(ravi);

        p.amount = 0;
        vm.expectRevert(IHisaabRegistry.ZeroAmount.selector);
        registry.createInvoice(p);
        p.amount = AMOUNT;

        p.dueDate = uint64(block.timestamp);
        vm.expectRevert(IHisaabRegistry.BadDueDate.selector);
        registry.createInvoice(p);
        p.dueDate = dueDate;

        p.docHash = bytes32(0);
        vm.expectRevert(IHisaabRegistry.NoDocHash.selector);
        registry.createInvoice(p);
        p.docHash = DOC;

        p.issuerName = string(new bytes(65));
        vm.expectRevert(IHisaabRegistry.NameTooLong.selector);
        registry.createInvoice(p);
        p.issuerName = ISSUER_NAME;

        p.clientName = string(new bytes(65));
        vm.expectRevert(IHisaabRegistry.NameTooLong.selector);
        registry.createInvoice(p);

        p.clientName = string(new bytes(64));
        registry.createInvoice(p);
        vm.stopPrank();
    }

    function test_PayFull_MintsReceipt_PaysIssuer() public {
        uint256 id = _create(acme);
        uint256 before = usdt.balanceOf(ravi);

        vm.expectEmit(true, false, false, true, address(registry));
        emit IHisaabRegistry.Settled(id, id);
        vm.expectEmit(true, true, false, true, address(registry));
        emit IHisaabRegistry.Paid(id, acme, AMOUNT, AMOUNT, false);
        vm.prank(acme);
        registry.pay(id, AMOUNT);

        Invoice memory inv = _inv(id);
        assertEq(uint8(inv.status), uint8(Status.Paid));
        assertEq(inv.payer, acme);
        assertEq(inv.paidAt, block.timestamp);
        assertEq(receipt.ownerOf(id), receipt.SINK());
        assertEq(usdt.balanceOf(ravi), before + AMOUNT);
        assertEq(usdt.balanceOf(address(registry)), 0, "registry holds nothing");
    }

    function test_PayPartialThenFull() public {
        uint256 id = _create(acme);
        vm.prank(acme);
        registry.pay(id, 200e6);
        assertEq(_status(id), uint8(Status.PartiallyPaid));
        assertEq(receipt.balanceOf(receipt.SINK()), 0);
        assertEq(_inv(id).paidAt, 0);

        vm.prank(acme);
        registry.pay(id, 300e6);
        assertEq(_status(id), uint8(Status.Paid));
        assertEq(receipt.balanceOf(receipt.SINK()), 1, "exactly one receipt");
        assertEq(receipt.ownerOf(id), receipt.SINK());
    }

    function test_RevertPay_Overpay_WrongClient_WrongPayer_Cancelled() public {
        uint256 id = _create(acme);
        vm.prank(acme);
        vm.expectRevert(IHisaabRegistry.Overpay.selector);
        registry.pay(id, AMOUNT + 1);

        vm.prank(stranger);
        vm.expectRevert(IHisaabRegistry.NotClient.selector);
        registry.pay(id, 1e6);

        CreateParams memory p = _params(address(0));
        p.docHash = keccak256("open");
        vm.prank(ravi);
        uint256 openId = registry.createInvoice(p);
        vm.prank(stranger);
        registry.pay(openId, 1e6);
        vm.prank(acme);
        vm.expectRevert(IHisaabRegistry.WrongPayer.selector);
        registry.pay(openId, 1e6);

        vm.prank(ravi);
        registry.cancel(id);
        vm.prank(acme);
        vm.expectRevert(IHisaabRegistry.NotPayable.selector);
        registry.pay(id, 1e6);

        vm.prank(stranger);
        registry.pay(openId, AMOUNT - 1e6);
        vm.prank(stranger);
        vm.expectRevert(IHisaabRegistry.NotPayable.selector);
        registry.pay(openId, 1);
    }

    function test_PayWithAuthorization_Gasless() public {
        uint256 id = _create(acme);
        bytes32 salt = keccak256("salt-1");
        uint256 validBefore = block.timestamp + 600;
        bytes memory sig = _sign(acmePk, acme, id, AMOUNT, salt, validBefore);

        vm.prank(acme);
        usdt.approve(address(registry), 0);

        vm.expectEmit(true, true, false, true, address(registry));
        emit IHisaabRegistry.Paid(id, acme, AMOUNT, AMOUNT, true);
        vm.prank(relayer, relayer);
        registry.payWithAuthorization(id, acme, AMOUNT, 0, validBefore, salt, sig);

        assertEq(_status(id), uint8(Status.Paid));
        assertEq(receipt.ownerOf(id), receipt.SINK());
        assertEq(usdt.balanceOf(address(registry)), 0, "funds only pass through");
    }

    function test_RevertAuth_ReusedForOtherInvoice() public {
        uint256 idA = _create(acme);
        CreateParams memory p = _params(acme);
        p.docHash = keccak256("B");
        vm.prank(ravi);
        uint256 idB = registry.createInvoice(p);

        bytes32 salt = keccak256("salt");
        uint256 validBefore = block.timestamp + 600;
        bytes memory sigForA = _sign(acmePk, acme, idA, 100e6, salt, validBefore);

        vm.prank(relayer);
        vm.expectRevert(MockUSDT.InvalidSignature.selector);
        registry.payWithAuthorization(idB, acme, 100e6, 0, validBefore, salt, sigForA);
    }

    function test_RevertAuth_ReplayAndAmountTamper() public {
        uint256 id = _create(acme);
        bytes32 salt = keccak256("salt");
        uint256 validBefore = block.timestamp + 600;
        bytes memory sig = _sign(acmePk, acme, id, 100e6, salt, validBefore);

        vm.prank(relayer);
        vm.expectRevert(MockUSDT.InvalidSignature.selector);
        registry.payWithAuthorization(id, acme, 200e6, 0, validBefore, salt, sig);

        vm.prank(relayer);
        registry.payWithAuthorization(id, acme, 100e6, 0, validBefore, salt, sig);
        vm.prank(relayer);
        vm.expectRevert(MockUSDT.AuthorizationUsed.selector);
        registry.payWithAuthorization(id, acme, 100e6, 0, validBefore, salt, sig);
    }

    function test_RevertAuth_StrangerSignature() public {
        uint256 id = _create(acme);
        (address eve, uint256 evePk) = makeAddrAndKey("eve");
        usdt.mint(eve, AMOUNT);
        bytes memory sig = _sign(evePk, eve, id, 100e6, keccak256("s"), block.timestamp + 600);
        vm.prank(relayer);
        vm.expectRevert(IHisaabRegistry.NotClient.selector);
        registry.payWithAuthorization(id, eve, 100e6, 0, block.timestamp + 600, keccak256("s"), sig);
    }

    function test_RefundPartial_KeepsReceipt() public {
        uint256 id = _create(acme);
        vm.prank(acme);
        registry.pay(id, AMOUNT);
        uint256 before = usdt.balanceOf(acme);

        vm.expectEmit(true, true, false, true, address(registry));
        emit IHisaabRegistry.Refunded(id, acme, 100e6, 100e6);
        vm.prank(ravi);
        registry.refund(id, 100e6);

        assertEq(usdt.balanceOf(acme), before + 100e6, "refund goes to payer");
        assertEq(_inv(id).refunded, 100e6);
        assertEq(_status(id), uint8(Status.Paid));
        assertEq(receipt.ownerOf(id), receipt.SINK());
    }

    function test_RefundFull_BurnsReceipt() public {
        uint256 id = _create(acme);
        vm.prank(acme);
        registry.pay(id, AMOUNT);

        vm.startPrank(ravi);
        registry.refund(id, 200e6);
        registry.refund(id, 300e6);
        vm.stopPrank();

        assertEq(_status(id), uint8(Status.Refunded));
        assertEq(receipt.balanceOf(receipt.SINK()), 0);
        vm.expectRevert();
        receipt.ownerOf(id);
    }

    function test_RevertRefund_OverRefund_NotIssuer() public {
        uint256 id = _create(acme);

        vm.prank(ravi);
        vm.expectRevert(IHisaabRegistry.NotRefundable.selector);
        registry.refund(id, 1e6);

        vm.prank(acme);
        registry.pay(id, 200e6);

        vm.prank(stranger);
        vm.expectRevert(IHisaabRegistry.NotIssuer.selector);
        registry.refund(id, 1e6);

        vm.prank(ravi);
        vm.expectRevert(IHisaabRegistry.OverRefund.selector);
        registry.refund(id, 200e6 + 1);

        vm.prank(ravi);
        registry.refund(id, 200e6);
        assertEq(_status(id), uint8(Status.Refunded));
        vm.prank(ravi);
        vm.expectRevert(IHisaabRegistry.NotRefundable.selector);
        registry.refund(id, 1);
    }

    function test_RevertPay_AfterPartialRefund() public {
        uint256 id = _create(acme);
        vm.prank(acme);
        registry.pay(id, 200e6);
        vm.prank(ravi);
        registry.refund(id, 100e6);
        assertEq(_status(id), uint8(Status.PartiallyPaid));

        vm.warp(dueDate + 1);
        assertFalse(registry.isOverdue(id), "unpayable invoice is not overdue");

        vm.prank(acme);
        vm.expectRevert(IHisaabRegistry.NotPayable.selector);
        registry.pay(id, 300e6);

        vm.prank(acme);
        vm.expectRevert(IHisaabRegistry.NotPayable.selector);
        registry.pay(id, 1);

        vm.prank(ravi);
        registry.refund(id, 100e6);
        assertEq(_status(id), uint8(Status.Refunded));
        assertEq(receipt.balanceOf(receipt.SINK()), 0);

        CreateParams memory p = _params(acme);
        p.docHash = keccak256("reissued");
        p.dueDate = uint64(block.timestamp + 14 days);
        p.supersedes = id;
        vm.prank(ravi);
        uint256 newId = registry.createInvoice(p);
        vm.prank(acme);
        registry.pay(newId, AMOUNT);
        assertEq(receipt.ownerOf(newId), receipt.SINK());
    }

    function test_CancelByEitherParty_OnlyWhenUnpaid() public {
        uint256 id1 = _create(acme);
        vm.expectEmit(true, true, false, false, address(registry));
        emit IHisaabRegistry.Cancelled(id1, acme);
        vm.prank(acme);
        registry.cancel(id1);
        assertEq(_status(id1), uint8(Status.Cancelled));

        CreateParams memory p = _params(acme);
        p.docHash = keccak256("2");
        vm.prank(ravi);
        uint256 id2 = registry.createInvoice(p);

        vm.prank(stranger);
        vm.expectRevert(IHisaabRegistry.NotParty.selector);
        registry.cancel(id2);

        vm.prank(acme);
        registry.pay(id2, 1e6);
        vm.prank(ravi);
        vm.expectRevert(IHisaabRegistry.NotCancellable.selector);
        registry.cancel(id2);

        vm.prank(ravi);
        vm.expectRevert(IHisaabRegistry.NotCancellable.selector);
        registry.cancel(id1);
    }

    function test_Supersede_OnlyOwnCancelled() public {
        uint256 oldId = _create(acme);
        CreateParams memory p = _params(acme);
        p.docHash = keccak256("v2");
        p.supersedes = oldId;

        vm.prank(ravi);
        vm.expectRevert(IHisaabRegistry.BadSupersede.selector);
        registry.createInvoice(p);

        vm.prank(ravi);
        registry.cancel(oldId);

        vm.prank(stranger);
        vm.expectRevert(IHisaabRegistry.BadSupersede.selector);
        registry.createInvoice(p);

        vm.expectEmit(true, true, true, true, address(registry));
        emit IHisaabRegistry.InvoiceCreated(2, ravi, acme, AMOUNT, dueDate, p.docHash, oldId);
        vm.prank(ravi);
        uint256 newId = registry.createInvoice(p);
        assertEq(_inv(newId).supersedes, oldId);
        assertEq(registry.supersededBy(oldId), newId);

        p.docHash = keccak256("v3");
        vm.prank(ravi);
        vm.expectRevert(IHisaabRegistry.BadSupersede.selector);
        registry.createInvoice(p);

        p.supersedes = 999;
        vm.prank(ravi);
        vm.expectRevert(IHisaabRegistry.BadSupersede.selector);
        registry.createInvoice(p);
    }

    function test_DustGrief_RecoverByRefundAndSupersede() public {
        uint256 id = _create(address(0));
        vm.prank(stranger);
        registry.pay(id, 1);
        vm.prank(acme);
        vm.expectRevert(IHisaabRegistry.WrongPayer.selector);
        registry.pay(id, AMOUNT);

        vm.prank(ravi);
        registry.refund(id, 1);
        assertEq(_status(id), uint8(Status.Refunded));

        CreateParams memory p = _params(acme);
        p.docHash = keccak256("reissued");
        p.supersedes = id;
        vm.prank(ravi);
        uint256 newId = registry.createInvoice(p);
        vm.prank(acme);
        registry.pay(newId, AMOUNT);
        assertEq(receipt.ownerOf(newId), receipt.SINK());
    }

    function test_IsOverdue() public {
        uint256 id = _create(acme);
        assertFalse(registry.isOverdue(id));
        vm.warp(dueDate + 1);
        assertTrue(registry.isOverdue(id));
        vm.prank(acme);
        registry.pay(id, 1e6);
        assertTrue(registry.isOverdue(id), "partially paid and late");
        vm.prank(acme);
        registry.pay(id, AMOUNT - 1e6);
        assertFalse(registry.isOverdue(id), "paid is never overdue");
        assertFalse(registry.isOverdue(999), "unknown id is never overdue");
    }

    function test_RevertUnknownInvoice() public {
        vm.prank(acme);
        vm.expectRevert(IHisaabRegistry.InvoiceNotFound.selector);
        registry.pay(42, 1e6);
        vm.expectRevert(IHisaabRegistry.InvoiceNotFound.selector);
        registry.cancel(42);
        vm.expectRevert(IHisaabRegistry.InvoiceNotFound.selector);
        registry.refund(42, 1);
    }

    function test_Constructor_RejectsWrongReceipt() public {
        HisaabReceipt wrong = new HisaabReceipt(address(0xdead), VERIFY_BASE);
        vm.expectRevert(IHisaabRegistry.BadReceipt.selector);
        new HisaabRegistry(IERC20(address(usdt)), wrong);
    }

    function testFuzz_PaidNeverExceedsAmount(uint128 a, uint128 b) public {
        a = uint128(bound(a, 1, AMOUNT));
        b = uint128(bound(b, 1, AMOUNT));
        uint256 id = _create(acme);

        vm.prank(acme);
        registry.pay(id, a);
        vm.prank(acme);
        if (uint256(a) + b > AMOUNT) {
            vm.expectRevert();
            registry.pay(id, b);
        } else {
            registry.pay(id, b);
        }
        Invoice memory inv = _inv(id);
        assertLe(inv.paid, inv.amount);
        assertEq(receipt.balanceOf(receipt.SINK()), inv.paid == inv.amount ? 1 : 0);
    }
}
