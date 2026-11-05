// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Whitechain test USDT EIP-712 domain: name "Tether USD", version "1" (no version() getter on-chain).
interface IEIP3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}
