// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

interface IAetheriaNFT {
    function mint() external returns (uint256);
    function mintBatch(uint256 quantity) external returns (uint256[] memory);
    function totalMinted() external view returns (uint256);
    function mintingActive() external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
} 