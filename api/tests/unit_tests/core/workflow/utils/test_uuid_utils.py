"""Unit tests for UUID v7 utility functions."""

import time
import uuid

from core.workflow.utils.uuid_utils import (
    get_timestamp_from_uuid7,
    is_uuid7,
    uuid7,
    uuid7_str,
)


class TestUUID7:
    """Test cases for UUID v7 generation and validation."""

    def test_uuid7_generates_valid_uuid(self):
        """Test that uuid7 generates a valid UUID instance."""
        result = uuid7()
        assert isinstance(result, uuid.UUID)
        assert result.version == 7

    def test_uuid7_str_returns_string(self):
        """Test that uuid7_str returns a properly formatted string."""
        result = uuid7_str()
        assert isinstance(result, str)
        assert len(result) == 36  # Standard UUID string length
        assert result.count("-") == 4  # Standard UUID format

    def test_uuid7_uniqueness(self):
        """Test that multiple UUID v7 calls generate unique IDs."""
        uuids = [uuid7() for _ in range(1000)]
        unique_uuids = set(uuids)
        assert len(uuids) == len(unique_uuids)

    def test_uuid7_monotonic_ordering(self):
        """Test that UUID v7 maintains monotonic ordering based on timestamp."""
        uuid1 = uuid7()
        time.sleep(0.002)  # Sleep for 2ms to ensure different timestamps
        uuid2 = uuid7()
        time.sleep(0.002)
        uuid3 = uuid7()

        # String comparison should preserve temporal ordering
        assert str(uuid1) < str(uuid2)
        assert str(uuid2) < str(uuid3)

    def test_is_uuid7_identifies_version(self):
        """Test that is_uuid7 correctly identifies UUID version 7."""
        uuid_v7 = uuid7()
        assert is_uuid7(uuid_v7) is True

        uuid_v4 = uuid.uuid4()
        assert is_uuid7(uuid_v4) is False

        uuid_v1 = uuid.uuid1()
        assert is_uuid7(uuid_v1) is False

    def test_get_timestamp_from_uuid7(self):
        """Test timestamp extraction from UUID v7."""
        # Generate UUID v7 and immediately get current time
        before_time = time.time()
        test_uuid = uuid7()
        after_time = time.time()

        # Extract timestamp from UUID
        extracted_timestamp = get_timestamp_from_uuid7(test_uuid)

        assert extracted_timestamp is not None
        # Allow small tolerance for timing precision (1 second)
        assert before_time - 1 <= extracted_timestamp <= after_time + 1

    def test_get_timestamp_from_non_uuid7_returns_none(self):
        """Test that timestamp extraction returns None for non-v7 UUIDs."""
        uuid_v4 = uuid.uuid4()
        result = get_timestamp_from_uuid7(uuid_v4)
        assert result is None

    def test_uuid7_format(self):
        """Test that UUID v7 has the correct format."""
        test_uuid = uuid7()
        uuid_str = str(test_uuid)

        # Check version bits (should be '7' in the 15th position)
        # Format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
        parts = uuid_str.split("-")
        assert len(parts) == 5
        assert parts[2][0] == "7"  # Version 7

        # Check variant bits (should be '8', '9', 'a', or 'b' in the 20th position)
        variant_char = parts[3][0]
        assert variant_char in "89ab"

    def test_concurrent_uuid7_generation(self):
        """Test that concurrent UUID v7 generation produces unique IDs."""
        import concurrent.futures

        def generate_batch():
            return [uuid7() for _ in range(100)]

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(generate_batch) for _ in range(10)]
            all_uuids = []
            for future in concurrent.futures.as_completed(futures):
                all_uuids.extend(future.result())

        # Check all UUIDs are unique
        assert len(all_uuids) == len(set(all_uuids))
        assert len(all_uuids) == 1000
