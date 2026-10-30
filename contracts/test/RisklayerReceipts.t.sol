// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RisklayerReceipts} from "../src/RisklayerReceipts.sol";

/// Minimal slice of the Foundry cheatcode interface, so the tests need no libraries.
interface Vm {
    function prank(address) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool) external;
    function warp(uint256) external;
}

contract RisklayerReceiptsTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    event AnswerRecorded(bytes32 indexed paymentRef, bytes32 indexed resultHash, address indexed payer, uint8 verdict, string sku);

    address constant SELLER = address(0x5E11E2);
    address constant PAYER = address(0xB0B);
    bytes32 constant REF = keccak256("RL-PR-1");
    bytes32 constant HASH = keccak256("answer");
    RisklayerReceipts receipts;

    function setUp() public {
        receipts = new RisklayerReceipts(SELLER);
    }

    function test_SellerRecordsReceipt() public {
        vm.warp(1_800_000_000);
        vm.prank(SELLER);
        receipts.record(REF, HASH, PAYER, 2, "trade-gate");
        (bytes32 resultHash, address payer, uint8 verdict, uint64 recordedAt, string memory sku) = receipts.receipts(REF);
        require(resultHash == HASH, "hash");
        require(payer == PAYER, "payer");
        require(verdict == 2, "verdict");
        require(recordedAt == 1_800_000_000, "time");
        require(keccak256(bytes(sku)) == keccak256("trade-gate"), "sku");
        require(receipts.count() == 1, "count");
    }

    function test_EmitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit AnswerRecorded(REF, HASH, PAYER, 3, "trade-gate");
        vm.prank(SELLER);
        receipts.record(REF, HASH, PAYER, 3, "trade-gate");
    }

    function test_RevertWhen_NotSeller() public {
        vm.prank(PAYER);
        vm.expectRevert(abi.encodeWithSelector(RisklayerReceipts.NotSeller.selector));
        receipts.record(REF, HASH, PAYER, 1, "trade-gate");
    }

    function test_RevertWhen_RecordedTwice() public {
        vm.prank(SELLER);
        receipts.record(REF, HASH, PAYER, 1, "trade-gate");
        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(RisklayerReceipts.AlreadyRecorded.selector, REF));
        receipts.record(REF, keccak256("other"), PAYER, 3, "trade-gate");
    }

    function test_RevertWhen_EmptyHash() public {
        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(RisklayerReceipts.EmptyResultHash.selector));
        receipts.record(REF, bytes32(0), PAYER, 1, "trade-gate");
    }

    function test_RevertWhen_UnknownVerdict() public {
        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(RisklayerReceipts.UnknownVerdict.selector, uint8(5)));
        receipts.record(REF, HASH, PAYER, 5, "trade-gate");
    }

    function testFuzz_CountTracksDistinctPayments(uint8 n) public {
        uint256 total = uint256(n) % 20;
        for (uint256 i = 0; i < total; i++) {
            vm.prank(SELLER);
            receipts.record(keccak256(abi.encode(i)), HASH, PAYER, 1, "pool-depth");
        }
        require(receipts.count() == total, "count");
    }
}
