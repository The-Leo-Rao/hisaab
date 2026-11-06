// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

import {BaseTest} from "./Base.t.sol";
import {HisaabReceipt} from "../src/HisaabReceipt.sol";
import {ReceiptSVG} from "../src/ReceiptSVG.sol";
import {QRCode} from "../src/QRCode.sol";
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

    function image(uint256 id, Invoice memory inv, string memory base) external pure returns (string memory) {
        return ReceiptSVG.svg(id, inv, base);
    }

    function qr(bytes memory text) external pure returns (bytes memory) {
        return QRCode.encode(text);
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

    function test_QR_StructureForVerifyUrl() public view {
        bytes memory m = svg.qr(bytes(string.concat(VERIFY_BASE, "1")));
        assertEq(m.length, 33 * 33);
        uint8[7] memory finderRow = [1, 0, 1, 1, 1, 0, 1];
        for (uint256 i; i < 7; ++i) {
            assertEq(uint8(m[2 * 33 + i]), finderRow[i], "top-left finder row 2");
            assertEq(uint8(m[i * 33 + 6]), 1, "finder edge column");
        }
        assertEq(uint8(m[6 * 33 + 8]), 1, "timing pattern");
        assertEq(uint8(m[6 * 33 + 9]), 0, "timing pattern");
        assertEq(uint8(m[25 * 33 + 8]), 1, "dark module");
        assertEq(uint8(m[26 * 33 + 26]), 1, "alignment centre");
        assertEq(uint8(m[25 * 33 + 26]), 0, "alignment ring");
    }

    function test_QR_TooLongUrlFallsBack() public {
        bytes memory longBase = new bytes(78);
        for (uint256 i; i < longBase.length; ++i) longBase[i] = "a";
        assertEq(svg.qr(longBase).length, 33 * 33);
        assertEq(svg.qr(bytes(string.concat(string(longBase), "1"))).length, 0);
        string memory img = svg.image(id, registry.getInvoice(id), string(longBase));
        assertTrue(_has(img, "verify online"));
        assertFalse(_has(img, "scale(4)"));
    }

    function test_Card_HasQrStatusAndNoPrivateData() public view {
        string memory img = svg.image(id, registry.getInvoice(id), VERIFY_BASE);
        assertTrue(_has(img, "SCAN TO VERIFY"));
        assertTrue(_has(img, "scale(4)"));
        assertTrue(_has(img, "#34d399"));
        assertTrue(_has(img, ISSUER_NAME));
        assertTrue(_has(img, "500.00"));
    }

    function test_TokenURI_GasFitsEthCall() public view {
        uint256 g = gasleft();
        receipt.tokenURI(id);
        assertLt(g - gasleft(), 20_000_000);
    }

    function _has(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i; i + n.length <= h.length; ++i) {
            bool ok = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
