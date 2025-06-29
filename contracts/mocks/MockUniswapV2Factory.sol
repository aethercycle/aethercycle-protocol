// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Aktor ini berpura-pura jadi "Pabrik LP". Tugasnya cuma satu:
// Kalau ditanya pasangan token A dan B, dia akan selalu ngasih alamat yang sama.
contract MockUniswapV2Factory {
    address public pairAddress;

    constructor(address _pairAddress) {
        pairAddress = _pairAddress;
    }

    function getPair(address, address) external view returns (address) {
        return pairAddress;
    }
}