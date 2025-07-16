// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFounderVesting {
    function updateDAO(address newDAO) external;
}

contract TestDAOUpdater {
    function updateDAO(address vesting, address newDAO) external {
        IFounderVesting(vesting).updateDAO(newDAO);
    }
} 