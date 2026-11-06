// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// QR version 4, error correction L, mask 0, byte mode (up to 78 bytes).
library QRCode {
    uint256 internal constant SIZE = 33;
    uint256 internal constant MAX_BYTES = 78;
    uint256 private constant DATA_CODEWORDS = 80;
    uint256 private constant ECC_CODEWORDS = 20;
    uint256 private constant FORMAT_BITS_L_MASK0 = 0x77C4;

    function encode(bytes memory text) internal pure returns (bytes memory modules) {
        if (text.length > MAX_BYTES) return "";
        modules = new bytes(SIZE * SIZE);
        bytes memory fn = new bytes(SIZE * SIZE);
        _drawFunctionPatterns(modules, fn);
        _drawCodewords(modules, fn, _codewords(text));
        for (uint256 y; y < SIZE; ++y) {
            for (uint256 x; x < SIZE; ++x) {
                uint256 i = y * SIZE + x;
                if (fn[i] == 0 && (x + y) % 2 == 0) modules[i] = modules[i] == 0 ? bytes1(0x01) : bytes1(0x00);
            }
        }
    }

    function svgPath(bytes memory modules, uint256 quiet) internal pure returns (string memory) {
        if (modules.length == 0) return "";
        bytes memory out = new bytes(SIZE * SIZE * 16);
        uint256 n;
        for (uint256 y; y < SIZE; ++y) {
            uint256 x;
            while (x < SIZE) {
                if (modules[y * SIZE + x] == 0) {
                    ++x;
                    continue;
                }
                uint256 start = x;
                while (x < SIZE && modules[y * SIZE + x] != 0) ++x;
                uint256 len = x - start;
                n = _put(out, n, "M");
                n = _num(out, n, start + quiet);
                n = _put(out, n, " ");
                n = _num(out, n, y + quiet);
                n = _put(out, n, "h");
                n = _num(out, n, len);
                n = _put(out, n, "v1h-");
                n = _num(out, n, len);
                n = _put(out, n, "z");
            }
        }
        assembly {
            mstore(out, n)
        }
        return string(out);
    }

    function _put(bytes memory out, uint256 n, string memory s) private pure returns (uint256) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; ++i) out[n + i] = b[i];
        return n + b.length;
    }

    function _num(bytes memory out, uint256 n, uint256 v) private pure returns (uint256) {
        if (v >= 10) out[n++] = bytes1(uint8(48 + v / 10));
        out[n++] = bytes1(uint8(48 + (v % 10)));
        return n;
    }

    function _set(bytes memory modules, bytes memory fn, uint256 x, uint256 y, bool dark) private pure {
        uint256 i = y * SIZE + x;
        modules[i] = dark ? bytes1(0x01) : bytes1(0x00);
        fn[i] = 0x01;
    }

    function _drawFunctionPatterns(bytes memory m, bytes memory fn) private pure {
        for (uint256 i; i < SIZE; ++i) {
            _set(m, fn, 6, i, i % 2 == 0);
            _set(m, fn, i, 6, i % 2 == 0);
        }
        _finder(m, fn, 3, 3);
        _finder(m, fn, SIZE - 4, 3);
        _finder(m, fn, 3, SIZE - 4);
        for (uint256 dy; dy < 5; ++dy) {
            for (uint256 dx; dx < 5; ++dx) {
                uint256 d = _max(_dist(dx, 2), _dist(dy, 2));
                _set(m, fn, 24 + dx, 24 + dy, d != 1);
            }
        }
        uint256 bits = FORMAT_BITS_L_MASK0;
        for (uint256 i; i <= 5; ++i) _set(m, fn, 8, i, _bit(bits, i));
        _set(m, fn, 8, 7, _bit(bits, 6));
        _set(m, fn, 8, 8, _bit(bits, 7));
        _set(m, fn, 7, 8, _bit(bits, 8));
        for (uint256 i = 9; i < 15; ++i) _set(m, fn, 14 - i, 8, _bit(bits, i));
        for (uint256 i; i < 8; ++i) _set(m, fn, SIZE - 1 - i, 8, _bit(bits, i));
        for (uint256 i = 8; i < 15; ++i) _set(m, fn, 8, SIZE - 15 + i, _bit(bits, i));
        _set(m, fn, 8, SIZE - 8, true);
    }

    function _finder(bytes memory m, bytes memory fn, uint256 cx, uint256 cy) private pure {
        for (uint256 dy; dy < 9; ++dy) {
            for (uint256 dx; dx < 9; ++dx) {
                if (cx + dx < 4 || cy + dy < 4) continue;
                uint256 x = cx + dx - 4;
                uint256 y = cy + dy - 4;
                if (x >= SIZE || y >= SIZE) continue;
                uint256 d = _max(_dist(dx, 4), _dist(dy, 4));
                _set(m, fn, x, y, d != 2 && d != 4);
            }
        }
    }

    function _codewords(bytes memory text) private pure returns (bytes memory all) {
        bytes memory data = new bytes(DATA_CODEWORDS);
        uint256 bitLen;
        bitLen = _appendBits(data, bitLen, 4, 4);
        bitLen = _appendBits(data, bitLen, text.length, 8);
        for (uint256 i; i < text.length; ++i) bitLen = _appendBits(data, bitLen, uint8(text[i]), 8);
        uint256 capacity = DATA_CODEWORDS * 8;
        uint256 term = capacity - bitLen < 4 ? capacity - bitLen : 4;
        bitLen += term;
        bitLen = (bitLen + 7) / 8 * 8;
        uint256 pad;
        for (uint256 i = bitLen / 8; i < DATA_CODEWORDS; ++i) {
            data[i] = pad % 2 == 0 ? bytes1(0xEC) : bytes1(0x11);
            ++pad;
        }
        bytes memory ecc = _reedSolomon(data);
        all = new bytes(DATA_CODEWORDS + ECC_CODEWORDS);
        for (uint256 i; i < DATA_CODEWORDS; ++i) all[i] = data[i];
        for (uint256 i; i < ECC_CODEWORDS; ++i) all[DATA_CODEWORDS + i] = ecc[i];
    }

    function _appendBits(bytes memory data, uint256 bitLen, uint256 value, uint256 count) private pure returns (uint256) {
        for (uint256 i = count; i > 0; --i) {
            if ((value >> (i - 1)) & 1 == 1) {
                data[bitLen / 8] = bytes1(uint8(data[bitLen / 8]) | uint8(1 << (7 - (bitLen % 8))));
            }
            ++bitLen;
        }
        return bitLen;
    }

    function _mul(uint256 x, uint256 y) private pure returns (uint256 z) {
        for (uint256 i = 8; i > 0; --i) {
            z = (z << 1) ^ ((z >> 7) * 0x11D);
            z ^= ((y >> (i - 1)) & 1) * x;
        }
    }

    function _reedSolomon(bytes memory data) private pure returns (bytes memory result) {
        uint256[ECC_CODEWORDS] memory div;
        div[ECC_CODEWORDS - 1] = 1;
        uint256 root = 1;
        for (uint256 i; i < ECC_CODEWORDS; ++i) {
            for (uint256 j; j < ECC_CODEWORDS; ++j) {
                div[j] = _mul(div[j], root);
                if (j + 1 < ECC_CODEWORDS) div[j] ^= div[j + 1];
            }
            root = _mul(root, 2);
        }
        uint256[ECC_CODEWORDS] memory rem;
        for (uint256 b; b < data.length; ++b) {
            uint256 factor = uint8(data[b]) ^ rem[0];
            for (uint256 i; i + 1 < ECC_CODEWORDS; ++i) rem[i] = rem[i + 1];
            rem[ECC_CODEWORDS - 1] = 0;
            for (uint256 i; i < ECC_CODEWORDS; ++i) rem[i] ^= _mul(div[i], factor);
        }
        result = new bytes(ECC_CODEWORDS);
        for (uint256 i; i < ECC_CODEWORDS; ++i) result[i] = bytes1(uint8(rem[i]));
    }

    function _drawCodewords(bytes memory m, bytes memory fn, bytes memory cw) private pure {
        uint256 i;
        uint256 total = cw.length * 8;
        for (int256 right = int256(SIZE) - 1; right >= 1; right -= 2) {
            if (right == 6) right = 5;
            bool upward = ((uint256(right) + 1) & 2) == 0;
            for (uint256 vert; vert < SIZE; ++vert) {
                for (uint256 j; j < 2; ++j) {
                    uint256 x = uint256(right) - j;
                    uint256 y = upward ? SIZE - 1 - vert : vert;
                    uint256 k = y * SIZE + x;
                    if (fn[k] == 0 && i < total) {
                        bool dark = (uint8(cw[i >> 3]) >> (7 - (i & 7))) & 1 == 1;
                        m[k] = dark ? bytes1(0x01) : bytes1(0x00);
                        ++i;
                    }
                }
            }
        }
    }

    function _bit(uint256 v, uint256 i) private pure returns (bool) {
        return (v >> i) & 1 == 1;
    }

    function _dist(uint256 a, uint256 center) private pure returns (uint256) {
        return a > center ? a - center : center - a;
    }

    function _max(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }
}
