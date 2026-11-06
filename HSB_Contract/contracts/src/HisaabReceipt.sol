// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import {IHisaabRegistry, Invoice} from "./interfaces/IHisaabRegistry.sol";
import {IERC5192} from "./interfaces/IERC5192.sol";
import {ReceiptSVG} from "./ReceiptSVG.sol";

// Deployed before the registry with its predicted address (see script/Deploy.s.sol).
contract HisaabReceipt is ERC721, IERC5192 {
    address public constant SINK = 0x000000000000000000000000000000000000dEaD;

    address public immutable registry;
    string public verifyBase;

    error OnlyRegistry();
    error Soulbound();

    constructor(address registry_, string memory verifyBase_) ERC721("Hisaab Receipt", "HSBR") {
        registry = registry_;
        verifyBase = verifyBase_;
    }

    modifier onlyRegistry() {
        if (msg.sender != registry) revert OnlyRegistry();
        _;
    }

    function mint(uint256 id) external onlyRegistry {
        _mint(SINK, id);
        emit Locked(id);
    }

    function burnByRegistry(uint256 id) external onlyRegistry {
        if (_ownerOf(id) != address(0)) _burn(id);
    }

    function locked(uint256) external pure returns (bool) {
        return true;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        Invoice memory inv = IHisaabRegistry(registry).getInvoice(id);
        return ReceiptSVG.tokenURI(id, inv, verifyBase);
    }

    function supportsInterface(bytes4 i) public view override returns (bool) {
        return i == 0xb45a3c0e || super.supportsInterface(i);
    }

    function _update(address to, uint256 id, address auth) internal override returns (address from) {
        from = super._update(to, id, auth);
        if (from != address(0) && to != address(0)) revert Soulbound();
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }
}
