// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HisaabRegistry} from "../src/HisaabRegistry.sol";
import {HisaabReceipt} from "../src/HisaabReceipt.sol";

// forge script script/Deploy.s.sol --rpc-url $WC_RPC --private-key $DEPLOYER_PK --broadcast
contract Deploy is Script {
    address constant WHITECHAIN_TEST_USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;

    function run() external returns (HisaabRegistry registry, HisaabReceipt receipt) {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address usdt = vm.envOr("USDT", WHITECHAIN_TEST_USDT);
        string memory verifyBase = vm.envOr("VERIFY_BASE", string("https://hisaab.vercel.app/verify/"));

        // Receipt and registry need each other's address: predict the registry at nonce + 1.
        uint64 nonce = vm.getNonce(deployer);
        address predictedRegistry = vm.computeCreateAddress(deployer, nonce + 1);

        vm.startBroadcast(pk);
        receipt = new HisaabReceipt(predictedRegistry, verifyBase);
        registry = new HisaabRegistry(IERC20(usdt), receipt);
        vm.stopBroadcast();

        require(address(registry) == predictedRegistry, "registry address mismatch");
        console2.log("NEXT_PUBLIC_REGISTRY=", address(registry));
        console2.log("NEXT_PUBLIC_RECEIPT= ", address(receipt));
        console2.log("USDT=                ", usdt);
        console2.log("DEPLOY_BLOCK=        ", block.number);
    }
}
