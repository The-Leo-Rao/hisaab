// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {HisaabReceiver} from "../src/HisaabReceiver.sol";

// Base Sepolia USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e, Ethereum Sepolia USDC 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
contract DeployReceiver is Script {
    function run() external returns (HisaabReceiver receiver) {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address usdc = vm.envAddress("USDC");
        address registry = vm.envAddress("REGISTRY");

        vm.startBroadcast(pk);
        receiver = new HisaabReceiver(usdc, 1874, registry);
        vm.stopBroadcast();

        console2.log("HisaabReceiver:", address(receiver));
    }
}
