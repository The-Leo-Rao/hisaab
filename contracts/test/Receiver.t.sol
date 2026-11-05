// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {HisaabReceiver} from "../src/HisaabReceiver.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";

contract ReceiverTest is Test {
    HisaabReceiver receiver;
    MockUSDT usdc;
    address client = makeAddr("client");
    address ravi = makeAddr("ravi");
    address registryOnWhitechain = makeAddr("registry");

    function setUp() public {
        usdc = new MockUSDT();
        receiver = new HisaabReceiver(address(usdc), 1874, registryOnWhitechain);
        usdc.mint(client, 1_000e6);
        vm.prank(client);
        usdc.approve(address(receiver), type(uint256).max);
    }

    function test_Pay_ForwardsToIssuerAndEmits() public {
        vm.expectEmit(true, true, true, true, address(receiver));
        emit HisaabReceiver.ForeignPaid(42, client, ravi, address(usdc), 250e6);
        vm.prank(client);
        receiver.pay(42, ravi, 250e6);

        assertEq(usdc.balanceOf(ravi), 250e6);
        assertEq(usdc.balanceOf(address(receiver)), 0, "receiver never holds funds");
    }

    function test_RevertPay_ZeroAmountOrIssuer() public {
        vm.startPrank(client);
        vm.expectRevert(HisaabReceiver.ZeroAmount.selector);
        receiver.pay(42, ravi, 0);
        vm.expectRevert(HisaabReceiver.ZeroIssuer.selector);
        receiver.pay(42, address(0), 1e6);
        vm.stopPrank();
    }
}
