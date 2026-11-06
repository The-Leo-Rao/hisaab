// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Optional, non-Whitechain chains only. This contract can't see Whitechain: consumers of ForeignPaid
// must check `issuer` == registry.getInvoice(invoiceId).issuer and `token` is the official USDC.
contract HisaabReceiver {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    uint256 public immutable registryChainId;
    address public immutable registry;

    event ForeignPaid(
        uint256 indexed invoiceId, address indexed payer, address indexed issuer, address token, uint256 amount
    );

    error ZeroAmount();
    error ZeroIssuer();

    constructor(address usdc_, uint256 registryChainId_, address registry_) {
        usdc = IERC20(usdc_);
        registryChainId = registryChainId_;
        registry = registry_;
    }

    function pay(uint256 invoiceId, address issuer, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (issuer == address(0)) revert ZeroIssuer();
        emit ForeignPaid(invoiceId, msg.sender, issuer, address(usdc), amount);
        usdc.safeTransferFrom(msg.sender, issuer, amount);
    }
}
