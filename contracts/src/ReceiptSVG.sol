// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {Invoice, Status} from "./interfaces/IHisaabRegistry.sol";
import {QRCode} from "./QRCode.sol";

library ReceiptSVG {
    using Strings for uint256;

    string internal constant DESCRIPTION = "Non-transferable proof that this invoice was paid in full onchain.";

    function tokenURI(uint256 id, Invoice memory inv, string memory verifyBase) internal pure returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json(id, inv, verifyBase))));
    }

    function json(uint256 id, Invoice memory inv, string memory verifyBase) internal pure returns (string memory) {
        return string.concat(
            '{"name":"Hisaab Receipt #',
            id.toString(),
            '","description":"',
            DESCRIPTION,
            '","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg(id, inv, verifyBase))),
            '","external_url":"',
            verifyUrl(id, verifyBase),
            '","attributes":',
            _attributes(inv),
            "}"
        );
    }

    function verifyUrl(uint256 id, string memory verifyBase) internal pure returns (string memory) {
        return string.concat(verifyBase, id.toString());
    }

    function svg(uint256 id, Invoice memory inv, string memory verifyBase) internal pure returns (string memory) {
        string memory accent = statusColor(inv);
        return string.concat(
            _frame(accent),
            _header(id),
            _body(inv, accent),
            _qrPanel(id, inv, verifyBase, accent),
            "</svg>"
        );
    }

    function statusColor(Invoice memory inv) internal pure returns (string memory) {
        if (inv.status == Status.Paid) return inv.refunded == 0 ? "#34d399" : "#fbbf24";
        if (inv.status == Status.Refunded || inv.status == Status.Cancelled) return "#f87171";
        return "#94a3b8";
    }

    function _frame(string memory accent) private pure returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">',
            '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#172544"/></linearGradient>',
            '<pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">',
            '<path d="M32 0H0V32" fill="none" stroke="#ffffff" stroke-opacity="0.035"/></pattern>',
            '<clipPath id="card"><rect width="640" height="400" rx="28"/></clipPath></defs>',
            '<g clip-path="url(#card)"><rect width="640" height="400" fill="url(#bg)"/>',
            '<rect width="640" height="400" fill="url(#grid)"/>',
            string.concat('<circle cx="600" cy="420" r="210" fill="', accent, '" fill-opacity="0.09"/>'),
            string.concat('<rect width="10" height="400" fill="', accent, '"/></g>')
        );
    }

    function _header(uint256 id) private pure returns (string memory) {
        return string.concat(
            '<text x="44" y="62" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="17" ',
            'font-weight="800" letter-spacing="6" fill="#f8fafc">HISAAB</text>',
            '<text x="44" y="86" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="11" ',
            'letter-spacing="2.5" fill="#94a3b8">PAYMENT RECEIPT \xC2\xB7 #',
            id.toString(),
            "</text>"
        );
    }

    function _body(Invoice memory inv, string memory accent) private pure returns (string memory) {
        string memory font = 'font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif"';
        string memory amount = string.concat(
            '<text x="42" y="168" ', font, ' font-size="58" font-weight="800" fill="#f8fafc">',
            formatAmount(inv.amount),
            string.concat('<tspan font-size="20" font-weight="600" dx="12" fill="', accent, '">USDT</tspan></text>')
        );
        bool sealedNames = bytes(inv.issuerName).length == 0;
        string memory names = string.concat(
            _label(44, 214, "FROM"),
            _value(44, 238, sealedNames ? "Sealed" : sanitize(inv.issuerName)),
            _label(44, 274, "TO"),
            _value(44, 298, sealedNames ? "Sealed" : _orDash(sanitize(inv.clientName)))
        );
        string memory foot = string.concat(
            _label(44, 338, "PAID ON"),
            '<text x="44" y="360" ', font, ' font-size="14" fill="#e2e8f0">', date(inv.paidAt), "</text>",
            _label(170, 338, "DOCUMENT"),
            '<text x="170" y="360" font-family="ui-monospace,Consolas,monospace" font-size="13" fill="#e2e8f0">',
            shortHash(inv.docHash),
            "</text>"
        );
        return string.concat(amount, names, foot);
    }

    function _qrPanel(uint256 id, Invoice memory inv, string memory verifyBase, string memory accent)
        private
        pure
        returns (string memory)
    {
        string memory path = QRCode.svgPath(QRCode.encode(bytes(verifyUrl(id, verifyBase))), 4);
        string memory code = bytes(path).length == 0
            ? '<text x="508" y="146" text-anchor="middle" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="13" fill="#0b1220">verify online</text>'
            : string.concat(
                '<g transform="translate(426 52) scale(4)"><path shape-rendering="crispEdges" fill="#0b1220" d="',
                path,
                '"/></g>'
            );
        return string.concat(
            '<rect x="418" y="44" width="180" height="180" rx="18" fill="#f8fafc"/>',
            code,
            '<text x="508" y="252" text-anchor="middle" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" ',
            'font-size="11" letter-spacing="3" fill="#cbd5e1">SCAN TO VERIFY</text>',
            _pill(statusLabel(inv), accent),
            '<text x="596" y="372" text-anchor="end" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" ',
            'font-size="11" letter-spacing="1" fill="#64748b">Whitechain \xC2\xB7 soulbound</text>'
        );
    }

    function _pill(string memory label, string memory accent) private pure returns (string memory) {
        return string.concat(
            '<rect x="418" y="272" width="180" height="36" rx="18" fill="', accent, '" fill-opacity="0.14" stroke="',
            accent,
            '" stroke-opacity="0.7"/><text x="508" y="295" text-anchor="middle" ',
            'font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="13" font-weight="700" fill="',
            accent,
            '">',
            label,
            "</text>"
        );
    }

    function _label(uint256 x, uint256 y, string memory text) private pure returns (string memory) {
        return string.concat(
            '<text x="', x.toString(), '" y="', y.toString(),
            '" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="10.5" letter-spacing="2.5" fill="#64748b">',
            text,
            "</text>"
        );
    }

    function _value(uint256 x, uint256 y, string memory text) private pure returns (string memory) {
        string memory size = bytes(text).length > 30 ? "13" : "17";
        return string.concat(
            '<text x="', x.toString(), '" y="', y.toString(),
            '" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="', size, '" font-weight="600" fill="#e2e8f0">',
            text,
            "</text>"
        );
    }

    function _attributes(Invoice memory inv) private pure returns (string memory) {
        string memory a = string.concat(
            '[{"trait_type":"amount","value":"',
            formatAmount(inv.amount),
            '"},{"trait_type":"token","value":"USDT"},{"trait_type":"issuerName","value":"',
            sanitize(inv.issuerName),
            '"},{"trait_type":"clientName","value":"',
            sanitize(inv.clientName),
            '"},'
        );
        string memory b = string.concat(
            '{"trait_type":"paidAt","display_type":"date","value":',
            uint256(inv.paidAt).toString(),
            '},{"trait_type":"status","value":"',
            statusLabel(inv),
            '"},{"trait_type":"docHash","value":"',
            Strings.toHexString(uint256(inv.docHash), 32),
            '"}]'
        );
        return string.concat(a, b);
    }

    function statusLabel(Invoice memory inv) internal pure returns (string memory) {
        Status s = inv.status;
        if (s == Status.Paid) {
            if (inv.refunded == 0) return "Paid";
            return string.concat("Paid (refunded ", formatAmount(inv.refunded), ")");
        }
        if (s == Status.Refunded) return "Refunded";
        if (s == Status.PartiallyPaid) return "PartiallyPaid";
        if (s == Status.Cancelled) return "Cancelled";
        return "Open";
    }

    function formatAmount(uint256 units) internal pure returns (string memory) {
        uint256 whole = units / 1e6;
        uint256 frac = units % 1e6;
        bytes memory f = bytes(frac.toString());
        bytes memory padded = new bytes(6);
        uint256 pad = 6 - f.length;
        for (uint256 i; i < 6; ++i) {
            padded[i] = i < pad ? bytes1("0") : f[i - pad];
        }
        uint256 len = 6;
        while (len > 2 && padded[len - 1] == "0") --len;
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = padded[i];
        }
        return string.concat(whole.toString(), ".", string(out));
    }

    function shortHash(bytes32 h) internal pure returns (string memory) {
        bytes memory full = bytes(Strings.toHexString(uint256(h), 32));
        bytes memory out = new bytes(10);
        for (uint256 i; i < 10; ++i) {
            out[i] = full[i];
        }
        return string.concat(string(out), "...");
    }

    function date(uint256 ts) internal pure returns (string memory) {
        if (ts == 0) return "-";
        // Howard Hinnant's civil-from-days algorithm (all values non-negative here).
        uint256 z = ts / 86400 + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 d = doy - (153 * mp + 2) / 5 + 1;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        uint256 y = yoe + era * 400 + (m <= 2 ? 1 : 0);
        return string.concat(y.toString(), "-", _pad2(m), "-", _pad2(d));
    }

    // Names are user-supplied: whitelist bytes so they cannot break out of the JSON or inject SVG markup.
    function sanitize(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == "."
                || c == "-" || c == "_" || uint8(c) >= 0x80;
            if (!ok) b[i] = "_";
        }
        return string(b);
    }

    function _orDash(string memory s) private pure returns (string memory) {
        if (bytes(s).length == 0) return "-";
        return s;
    }

    function _pad2(uint256 v) private pure returns (string memory) {
        return v < 10 ? string.concat("0", v.toString()) : v.toString();
    }
}
