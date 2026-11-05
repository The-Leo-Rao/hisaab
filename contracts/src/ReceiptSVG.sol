// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {Invoice, Status} from "./interfaces/IHisaabRegistry.sol";

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
            Base64.encode(bytes(svg(inv))),
            '","external_url":"',
            verifyBase,
            id.toString(),
            '","attributes":',
            _attributes(inv),
            "}"
        );
    }

    function svg(Invoice memory inv) internal pure returns (string memory) {
        string memory head = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250">',
            '<rect width="400" height="250" rx="16" fill="#0f172a"/>',
            '<text x="24" y="38" font-family="monospace" font-size="14" fill="#34d399">HISAAB RECEIPT</text>',
            '<text x="24" y="82" font-family="monospace" font-size="30" fill="#f8fafc">',
            formatAmount(inv.amount),
            " USDT</text>"
        );
        string memory names = string.concat(
            '<text x="24" y="118" font-family="monospace" font-size="13" fill="#cbd5e1">from ',
            sanitize(inv.issuerName),
            '</text><text x="24" y="140" font-family="monospace" font-size="13" fill="#cbd5e1">to ',
            _orDash(sanitize(inv.clientName)),
            "</text>"
        );
        string memory foot = string.concat(
            '<text x="24" y="176" font-family="monospace" font-size="12" fill="#94a3b8">paid ',
            date(inv.paidAt),
            '</text><text x="24" y="198" font-family="monospace" font-size="12" fill="#94a3b8">doc ',
            shortHash(inv.docHash),
            '</text><text x="24" y="230" font-family="monospace" font-size="13" fill="#fbbf24">',
            statusLabel(inv),
            "</text></svg>"
        );
        return string.concat(head, names, foot);
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
