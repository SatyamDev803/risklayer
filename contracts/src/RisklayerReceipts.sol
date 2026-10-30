// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RisklayerReceipts
/// @notice One audit record per paid Risklayer answer on HSK Chain.
/// @dev A receipt shows which answer (by result hash) the seller stood behind
///      for which HSP payment. It does not prove the answer's data was true.
contract RisklayerReceipts {
    struct Receipt {
        bytes32 resultHash;
        address payer;
        uint8 verdict;
        uint64 recordedAt;
        string sku;
    }

    /// @notice 0 INFO, 1 ALLOW, 2 REDUCE, 3 BLOCK, 4 HOLD
    uint8 public constant MAX_VERDICT = 4;

    /// @notice The only address allowed to record. Fixed at deploy.
    address public immutable seller;

    /// @notice keccak256(HSP payment_request_id) => receipt
    mapping(bytes32 => Receipt) public receipts;
    uint256 public count;

    event AnswerRecorded(bytes32 indexed paymentRef, bytes32 indexed resultHash, address indexed payer, uint8 verdict, string sku);

    error NotSeller();
    error AlreadyRecorded(bytes32 paymentRef);
    error EmptyResultHash();
    error UnknownVerdict(uint8 verdict);

    constructor(address seller_) {
        seller = seller_;
    }

    /// @notice Record the answer sold for one payment. Each payment is recorded once.
    function record(bytes32 paymentRef, bytes32 resultHash, address payer, uint8 verdict, string calldata sku) external {
        if (msg.sender != seller) revert NotSeller();
        if (resultHash == bytes32(0)) revert EmptyResultHash();
        if (verdict > MAX_VERDICT) revert UnknownVerdict(verdict);
        if (receipts[paymentRef].recordedAt != 0) revert AlreadyRecorded(paymentRef);
        receipts[paymentRef] = Receipt(resultHash, payer, verdict, uint64(block.timestamp), sku);
        unchecked {
            ++count;
        }
        emit AnswerRecorded(paymentRef, resultHash, payer, verdict, sku);
    }
}
