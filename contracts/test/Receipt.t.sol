// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

import {BaseTest} from "./Base.t.sol";
import {HisaabReceipt} from "../src/HisaabReceipt.sol";
import {ReceiptSVG} from "../src/ReceiptSVG.sol";
import {Invoice, CreateParams} from "../src/interfaces/IHisaabRegistry.sol";

contract ReceiptSVGHarness {
    function json(uint256 id, Invoice memory inv, string memory base) external pure returns (string memory) {
        return ReceiptSVG.json(id, inv, base);
    }

    function date(uint256 ts) external pure returns (string memory) {
        return ReceiptSVG.date(ts);
    }

    function formatAmount(uint256 units) external pure returns (string memory) {
        return ReceiptSVG.formatAmount(units);
    }

    function sanitize(string memory s) external pure returns (string memory) {
        return ReceiptSVG.sanitize(s);
    }
}

contract ReceiptTest is BaseTest {
    ReceiptSVGHarness svg;
    uint256 id;

    function setUp() public override {
        super.setUp();
        svg = new ReceiptSVGHarness();
        id = _create(acme);
        vm.prank(acme);
        registry.pay(id, AMOUNT);
    }

    function test_RevertTransfer_Soulbound() public {
        vm.startPrank(ravi);
        vm.expectRevert(HisaabReceipt.Soulbound.selector);
        receipt.transferFrom(ravi, stranger, id);
        vm.expectRevert(HisaabReceipt.Soulbound.selector);
        receipt.safeTransferFrom(ravi, stranger, id);
        vm.expectRevert(HisaabReceipt.Soulbound.selector);
        receipt.safeTransferFrom(ravi, stranger, id, "");
        vm.expectRevert(HisaabReceipt.Soulbound.selector);
        receipt.approve(stranger, id);
        vm.expectRevert(HisaabReceipt.Soulbound.selector);
        receipt.setApprovalForAll(stranger, true);
        vm.stopPrank();
        assertEq(receipt.ownerOf(id), ravi);
    }

    function test_RevertMint_NotRegistry() public {
        vm.prank(ravi);
        vm.expectRevert(HisaabReceipt.OnlyRegistry.selector);
        receipt.mint(ravi, 99);
        vm.prank(ravi);
        vm.expectRevert(HisaabReceipt.OnlyRegistry.selector);
        receipt.burnByRegistry(id);
    }

    function test_LockedAndInterface() public view {
        assertTrue(receipt.locked(id));
        assertTrue(receipt.supportsInterface(0xb45a3c0e));
        assertTrue(receipt.supportsInterface(0x80ac58cd));
        assertTrue(receipt.supportsInterface(0x5b5e139f));
        assertEq(receipt.registry(), address(registry));
        assertEq(receipt.verifyBase(), VERIFY_BASE);
    }

    function test_TokenURI_NoPrivateFields() public view {
        Invoice memory inv = registry.getInvoice(id);
        string memory json = svg.json(id, inv, VERIFY_BASE);

        assertEq(
            receipt.tokenURI(id), string.concat("data:application/json;base64,", Base64.encode(bytes(json)))
        );

        string[] memory keys = vm.parseJsonKeys(json, "$");
        assertEq(keys.length, 5);
        assertEq(vm.parseJsonString(json, ".name"), "Hisaab Receipt #1");
        assertEq(vm.parseJsonString(json, ".external_url"), "https://hisaab.vercel.app/verify/1");

        string[6] memory banned = ['"gstin', '"GSTIN', '"pan', '"PAN', '"lines', '"email'];
        for (uint256 i; i < banned.length; ++i) {
            assertEq(vm.indexOf(json, banned[i]), type(uint256).max, banned[i]);
        }
        assertTrue(vm.indexOf(json, "acme-q4.ravi-dev.eth") != type(uint256).max);
    }

    function test_HolderCanBurn() public {
        vm.prank(stranger);
        vm.expectRevert(HisaabReceipt.NotHolder.selector);
        receipt.burn(id);

        vm.prank(ravi);
        receipt.burn(id);
        assertEq(receipt.balanceOf(ravi), 0);
        assertEq(registry.getInvoice(id).paid, AMOUNT);
    }

    function test_TokenURI_StatusShowsPartialRefund() public {
        vm.prank(ravi);
        registry.refund(id, 125_500000);
        string memory json = svg.json(id, registry.getInvoice(id), VERIFY_BASE);
        assertTrue(vm.indexOf(json, "Paid (refunded 125.50)") != type(uint256).max);
    }

    function test_TokenURI_NameInjectionSanitized() public {
        CreateParams memory p = _params(acme);
        p.docHash = keccak256("evil");
        p.issuerName = 'x"},{"pan":"<script>';
        vm.prank(ravi);
        uint256 evil = registry.createInvoice(p);
        vm.prank(acme);
        registry.pay(evil, AMOUNT);

        string memory json = svg.json(evil, registry.getInvoice(evil), VERIFY_BASE);
        assertEq(vm.parseJsonKeys(json, "$").length, 5, "still valid JSON, no injected keys");
        assertEq(vm.indexOf(json, "<script"), type(uint256).max);
        assertEq(svg.sanitize('a"b<c>d e'), "a_b_c_d_e");
    }

    function test_DateAndAmountFormatting() public view {
        assertEq(svg.date(0), "-");
        assertEq(svg.date(1762387200), "2025-11-06");
        assertEq(svg.date(951782400), "2000-02-29");
        assertEq(svg.formatAmount(500e6), "500.00");
        assertEq(svg.formatAmount(12_500000), "12.50");
        assertEq(svg.formatAmount(1234), "0.001234");
    }
}
