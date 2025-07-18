import struct
import time
import uuid
from unittest import mock

import pytest
from hypothesis import given
from hypothesis import strategies as st

from libs.uuid_utils import _create_uuidv7_bytes, uuidv7, uuidv7_boundary, uuidv7_timestamp


# Tests for private helper function _create_uuidv7_bytes
def test_create_uuidv7_bytes_basic_structure():
    """Test basic byte structure creation."""
    timestamp_ms = 1609459200000  # 2021-01-01 00:00:00 UTC in milliseconds
    random_bytes = b"\x12\x34\x56\x78\x9a\xbc\xde\xf0\x11\x22"

    result = _create_uuidv7_bytes(timestamp_ms, random_bytes)

    # Should be exactly 16 bytes
    assert len(result) == 16
    assert isinstance(result, bytes)

    # Create UUID from bytes to verify it's valid
    uuid_obj = uuid.UUID(bytes=result)
    assert uuid_obj.version == 7


def test_create_uuidv7_bytes_timestamp_encoding():
    """Test timestamp is correctly encoded in first 48 bits."""
    timestamp_ms = 1609459200000  # 2021-01-01 00:00:00 UTC in milliseconds
    random_bytes = b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"

    result = _create_uuidv7_bytes(timestamp_ms, random_bytes)

    # Extract timestamp from first 6 bytes
    timestamp_bytes = b"\x00\x00" + result[0:6]
    extracted_timestamp = struct.unpack(">Q", timestamp_bytes)[0]

    assert extracted_timestamp == timestamp_ms


def test_create_uuidv7_bytes_version_bits():
    """Test version bits are set to 7."""
    timestamp_ms = 1609459200000
    random_bytes = b"\xff\xff\x00\x00\x00\x00\x00\x00\x00\x00"  # Set first 2 bytes to all 1s

    result = _create_uuidv7_bytes(timestamp_ms, random_bytes)

    # Extract version from bytes 6-7
    version_and_rand_a = struct.unpack(">H", result[6:8])[0]
    version = (version_and_rand_a >> 12) & 0x0F

    assert version == 7


def test_create_uuidv7_bytes_variant_bits():
    """Test variant bits are set correctly."""
    timestamp_ms = 1609459200000
    random_bytes = b"\x00\x00\xff\x00\x00\x00\x00\x00\x00\x00"  # Set byte 8 to all 1s

    result = _create_uuidv7_bytes(timestamp_ms, random_bytes)

    # Check variant bits in byte 8 (should be 10xxxxxx)
    variant_byte = result[8]
    variant_bits = (variant_byte >> 6) & 0b11

    assert variant_bits == 0b10  # Should be binary 10


def test_create_uuidv7_bytes_random_data():
    """Test random bytes are placed correctly."""
    timestamp_ms = 1609459200000
    random_bytes = b"\x12\x34\x56\x78\x9a\xbc\xde\xf0\x11\x22"

    result = _create_uuidv7_bytes(timestamp_ms, random_bytes)

    # Check random data A (12 bits from bytes 6-7, excluding version)
    version_and_rand_a = struct.unpack(">H", result[6:8])[0]
    rand_a = version_and_rand_a & 0x0FFF
    expected_rand_a = struct.unpack(">H", random_bytes[0:2])[0] & 0x0FFF
    assert rand_a == expected_rand_a

    # Check random data B (bytes 8-15, with variant bits preserved)
    # Byte 8 should have variant bits set but preserve lower 6 bits
    expected_byte_8 = (random_bytes[2] & 0x3F) | 0x80
    assert result[8] == expected_byte_8

    # Bytes 9-15 should match random_bytes[3:10]
    assert result[9:16] == random_bytes[3:10]


def test_create_uuidv7_bytes_zero_random():
    """Test with zero random bytes (boundary case)."""
    timestamp_ms = 1609459200000
    zero_random_bytes = b"\x00" * 10

    result = _create_uuidv7_bytes(timestamp_ms, zero_random_bytes)

    # Should still be valid UUIDv7
    uuid_obj = uuid.UUID(bytes=result)
    assert uuid_obj.version == 7

    # Version bits should be 0x7000
    version_and_rand_a = struct.unpack(">H", result[6:8])[0]
    assert version_and_rand_a == 0x7000

    # Variant byte should be 0x80 (variant bits + zero random bits)
    assert result[8] == 0x80

    # Remaining bytes should be zero
    assert result[9:16] == b"\x00" * 7


def test_uuidv7_basic_generation():
    """Test basic UUID generation produces valid UUIDv7."""
    result = uuidv7()

    # Should be a UUID object
    assert isinstance(result, uuid.UUID)

    # Should be version 7
    assert result.version == 7

    # Should have correct variant (RFC 4122 variant)
    # Variant bits should be 10xxxxxx (0x80-0xBF range)
    variant_byte = result.bytes[8]
    assert (variant_byte >> 6) == 0b10


def test_uuidv7_with_custom_timestamp():
    """Test UUID generation with custom timestamp."""
    custom_timestamp = 1609459200000  # 2021-01-01 00:00:00 UTC in milliseconds
    result = uuidv7(custom_timestamp)

    assert isinstance(result, uuid.UUID)
    assert result.version == 7

    # Extract and verify timestamp
    extracted_timestamp = uuidv7_timestamp(result)
    assert isinstance(extracted_timestamp, int)
    assert extracted_timestamp == custom_timestamp  # Exact match for integer milliseconds


def test_uuidv7_with_none_timestamp(monkeypatch):
    """Test UUID generation with None timestamp uses current time."""
    mock_time = 1609459200
    mock_time_func = mock.Mock(return_value=mock_time)
    monkeypatch.setattr("time.time", mock_time_func)
    result = uuidv7(None)

    assert isinstance(result, uuid.UUID)
    assert result.version == 7

    # Should use the mocked current time (converted to milliseconds)
    assert mock_time_func.called
    extracted_timestamp = uuidv7_timestamp(result)
    assert extracted_timestamp == mock_time * 1000  # 1609459200.0 * 1000


def test_uuidv7_time_ordering():
    """Test that sequential UUIDs have increasing timestamps."""
    # Generate UUIDs with incrementing timestamps (in milliseconds)
    timestamp1 = 1609459200000  # 2021-01-01 00:00:00 UTC
    timestamp2 = 1609459201000  # 2021-01-01 00:00:01 UTC
    timestamp3 = 1609459202000  # 2021-01-01 00:00:02 UTC

    uuid1 = uuidv7(timestamp1)
    uuid2 = uuidv7(timestamp2)
    uuid3 = uuidv7(timestamp3)

    # Extract timestamps
    ts1 = uuidv7_timestamp(uuid1)
    ts2 = uuidv7_timestamp(uuid2)
    ts3 = uuidv7_timestamp(uuid3)

    # Should be in ascending order
    assert ts1 < ts2 < ts3

    # UUIDs should be lexicographically ordered by their string representation
    # due to time-ordering property of UUIDv7
    uuid_strings = [str(uuid1), str(uuid2), str(uuid3)]
    assert uuid_strings == sorted(uuid_strings)


def test_uuidv7_uniqueness():
    """Test that multiple calls generate different UUIDs."""
    # Generate multiple UUIDs with the same timestamp (in milliseconds)
    timestamp = 1609459200000
    uuids = [uuidv7(timestamp) for _ in range(100)]

    # All should be unique despite same timestamp (due to random bits)
    assert len(set(uuids)) == 100

    # All should have the same extracted timestamp
    for uuid_obj in uuids:
        extracted_ts = uuidv7_timestamp(uuid_obj)
        assert extracted_ts == timestamp


def test_uuidv7_timestamp_error_handling_wrong_version():
    """Test error handling for non-UUIDv7 inputs."""

    uuid_v4 = uuid.uuid4()
    with pytest.raises(ValueError) as exc_ctx:
        uuidv7_timestamp(uuid_v4)
    assert "Expected UUIDv7 (version 7)" in str(exc_ctx.value)
    assert f"got version {uuid_v4.version}" in str(exc_ctx.value)


@given(st.integers(max_value=2**48 - 1, min_value=0))
def test_uuidv7_timestamp_round_trip(timestamp_ms):
    # Generate UUID with timestamp
    uuid_obj = uuidv7(timestamp_ms)

    # Extract timestamp back
    extracted_timestamp = uuidv7_timestamp(uuid_obj)

    # Should match exactly for integer millisecond timestamps
    assert extracted_timestamp == timestamp_ms


def test_uuidv7_timestamp_edge_cases():
    """Test timestamp extraction with edge case values."""
    # Test with very small timestamp
    small_timestamp = 1  # 1ms after epoch
    uuid_small = uuidv7(small_timestamp)
    extracted_small = uuidv7_timestamp(uuid_small)
    assert extracted_small == small_timestamp

    # Test with large timestamp (year 2038+)
    large_timestamp = 2147483647000  # 2038-01-19 03:14:07 UTC in milliseconds
    uuid_large = uuidv7(large_timestamp)
    extracted_large = uuidv7_timestamp(uuid_large)
    assert extracted_large == large_timestamp


def test_uuidv7_boundary_basic_generation():
    """Test basic boundary UUID generation with a known timestamp."""
    timestamp = 1609459200000  # 2021-01-01 00:00:00 UTC in milliseconds
    result = uuidv7_boundary(timestamp)

    # Should be a UUID object
    assert isinstance(result, uuid.UUID)

    # Should be version 7
    assert result.version == 7

    # Should have correct variant (RFC 4122 variant)
    # Variant bits should be 10xxxxxx (0x80-0xBF range)
    variant_byte = result.bytes[8]
    assert (variant_byte >> 6) == 0b10


def test_uuidv7_boundary_timestamp_extraction():
    """Test that boundary UUID timestamp can be extracted correctly."""
    timestamp = 1609459200000  # 2021-01-01 00:00:00 UTC in milliseconds
    boundary_uuid = uuidv7_boundary(timestamp)

    # Extract timestamp using existing function
    extracted_timestamp = uuidv7_timestamp(boundary_uuid)

    # Should match exactly
    assert extracted_timestamp == timestamp


def test_uuidv7_boundary_deterministic():
    """Test that boundary UUIDs are deterministic for same timestamp."""
    timestamp = 1609459200000  # 2021-01-01 00:00:00 UTC in milliseconds

    # Generate multiple boundary UUIDs with same timestamp
    uuid1 = uuidv7_boundary(timestamp)
    uuid2 = uuidv7_boundary(timestamp)
    uuid3 = uuidv7_boundary(timestamp)

    # Should all be identical
    assert uuid1 == uuid2 == uuid3
    assert str(uuid1) == str(uuid2) == str(uuid3)


def test_uuidv7_boundary_is_minimum():
    """Test that boundary UUID is lexicographically smaller than regular UUIDs."""
    timestamp = 1609459200000  # 2021-01-01 00:00:00 UTC in milliseconds

    # Generate boundary UUID
    boundary_uuid = uuidv7_boundary(timestamp)

    # Generate multiple regular UUIDs with same timestamp
    regular_uuids = [uuidv7(timestamp) for _ in range(50)]

    # Boundary UUID should be lexicographically smaller than all regular UUIDs
    boundary_str = str(boundary_uuid)
    for regular_uuid in regular_uuids:
        regular_str = str(regular_uuid)
        assert boundary_str < regular_str, f"Boundary {boundary_str} should be < regular {regular_str}"

    # Also test with bytes comparison
    boundary_bytes = boundary_uuid.bytes
    for regular_uuid in regular_uuids:
        regular_bytes = regular_uuid.bytes
        assert boundary_bytes < regular_bytes


def test_uuidv7_boundary_different_timestamps():
    """Test that boundary UUIDs with different timestamps are ordered correctly."""
    timestamp1 = 1609459200000  # 2021-01-01 00:00:00 UTC
    timestamp2 = 1609459201000  # 2021-01-01 00:00:01 UTC
    timestamp3 = 1609459202000  # 2021-01-01 00:00:02 UTC

    uuid1 = uuidv7_boundary(timestamp1)
    uuid2 = uuidv7_boundary(timestamp2)
    uuid3 = uuidv7_boundary(timestamp3)

    # Extract timestamps to verify
    ts1 = uuidv7_timestamp(uuid1)
    ts2 = uuidv7_timestamp(uuid2)
    ts3 = uuidv7_timestamp(uuid3)

    # Should be in ascending order
    assert ts1 < ts2 < ts3

    # UUIDs should be lexicographically ordered
    uuid_strings = [str(uuid1), str(uuid2), str(uuid3)]
    assert uuid_strings == sorted(uuid_strings)

    # Bytes should also be ordered
    assert uuid1.bytes < uuid2.bytes < uuid3.bytes


def test_uuidv7_boundary_edge_cases():
    """Test boundary UUID generation with edge case timestamp values."""
    # Test with timestamp 0 (Unix epoch)
    epoch_uuid = uuidv7_boundary(0)
    assert isinstance(epoch_uuid, uuid.UUID)
    assert epoch_uuid.version == 7
    assert uuidv7_timestamp(epoch_uuid) == 0

    # Test with very large timestamp values
    large_timestamp = 2147483647000  # 2038-01-19 03:14:07 UTC in milliseconds
    large_uuid = uuidv7_boundary(large_timestamp)
    assert isinstance(large_uuid, uuid.UUID)
    assert large_uuid.version == 7
    assert uuidv7_timestamp(large_uuid) == large_timestamp

    # Test with current time
    current_time = int(time.time() * 1000)
    current_uuid = uuidv7_boundary(current_time)
    assert isinstance(current_uuid, uuid.UUID)
    assert current_uuid.version == 7
    assert uuidv7_timestamp(current_uuid) == current_time
