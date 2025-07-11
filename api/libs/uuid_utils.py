import secrets
import struct
import time
import uuid

# Reference for UUIDv7 specification:
# RFC 9562, Section 5.7 - https://www.rfc-editor.org/rfc/rfc9562.html#section-5.7

# Define the format for packing the timestamp as an unsigned 64-bit integer (big-endian).
#
# For details on the `struct.pack` format, refer to:
# https://docs.python.org/3/library/struct.html#byte-order-size-and-alignment
_PACK_TIMESTAMP = ">Q"

# Define the format for packing the 12-bit random data A (as specified in RFC 9562 Section 5.7)
# into an unsigned 16-bit integer (big-endian).
_PACK_RAND_A = ">H"


def _create_uuidv7_bytes(timestamp_ms: int, random_bytes: bytes) -> bytes:
    """Create UUIDv7 byte structure with given timestamp and random bytes.

    This is a private helper function that handles the common logic for creating
    UUIDv7 byte structure according to RFC 9562 specification.

    UUIDv7 Structure:
    - 48 bits: timestamp (milliseconds since Unix epoch)
    - 12 bits: random data A (with version bits)
    - 62 bits: random data B (with variant bits)

    The function performs the following operations:
    1. Creates a 128-bit (16-byte) UUID structure
    2. Packs the timestamp into the first 48 bits (6 bytes)
    3. Sets the version bits to 7 (0111) in the correct position
    4. Sets the variant bits to 10 (binary) in the correct position
    5. Fills the remaining bits with the provided random bytes

    Args:
        timestamp_ms: The timestamp in milliseconds since Unix epoch (48 bits).
        random_bytes: Random bytes to use for the random portions (must be 10 bytes).
                     First 2 bytes are used for random data A (12 bits after version).
                     Last 8 bytes are used for random data B (62 bits after variant).

    Returns:
        A 16-byte bytes object representing the complete UUIDv7 structure.

    Note:
        This function assumes the random_bytes parameter is exactly 10 bytes.
        The caller is responsible for providing appropriate random data.
    """
    # Create the 128-bit UUID structure
    uuid_bytes = bytearray(16)

    # Pack timestamp (48 bits) into first 6 bytes
    uuid_bytes[0:6] = struct.pack(_PACK_TIMESTAMP, timestamp_ms)[2:8]  # Take last 6 bytes of 8-byte big-endian

    # Next 16 bits: random data A (12 bits) + version (4 bits)
    # Take first 2 random bytes and set version to 7
    rand_a = struct.unpack(_PACK_RAND_A, random_bytes[0:2])[0]
    # Clear the highest 4 bits to make room for the version field
    # by performing a bitwise AND with 0x0FFF (binary: 0b0000_1111_1111_1111).
    rand_a = rand_a & 0x0FFF
    # Set the version field to 7 (binary: 0111) by performing a bitwise OR with 0x7000 (binary: 0b0111_0000_0000_0000).
    rand_a = rand_a | 0x7000
    uuid_bytes[6:8] = struct.pack(_PACK_RAND_A, rand_a)

    # Last 64 bits: random data B (62 bits) + variant (2 bits)
    # Use remaining 8 random bytes and set variant to 10 (binary)
    uuid_bytes[8:16] = random_bytes[2:10]

    # Set variant bits (first 2 bits of byte 8 should be '10')
    uuid_bytes[8] = (uuid_bytes[8] & 0x3F) | 0x80  # Set variant to 10xxxxxx

    return bytes(uuid_bytes)


def uuidv7(timestamp_ms: int | None = None) -> uuid.UUID:
    """Generate a UUID version 7 according to RFC 9562 specification.

    UUIDv7 features a time-ordered value field derived from the widely
    implemented and well known Unix Epoch timestamp source, the number of
    milliseconds since midnight 1 Jan 1970 UTC, leap seconds excluded.

    Structure:
    - 48 bits: timestamp (milliseconds since Unix epoch)
    - 12 bits: random data A (with version bits)
    - 62 bits: random data B (with variant bits)

    Args:
        timestamp_ms: The timestamp used when generating UUID, use the current time if unspecified.
                  Should be an integer representing milliseconds since Unix epoch.

    Returns:
        A UUID object representing a UUIDv7.

    Example:
        >>> import time
        >>> # Generate UUIDv7 with current time
        >>> uuid_current = uuidv7()
        >>> # Generate UUIDv7 with specific timestamp
        >>> uuid_specific = uuidv7(int(time.time() * 1000))
    """
    if timestamp_ms is None:
        timestamp_ms = int(time.time() * 1000)

    # Generate 10 random bytes for the random portions
    random_bytes = secrets.token_bytes(10)

    # Create UUIDv7 bytes using the helper function
    uuid_bytes = _create_uuidv7_bytes(timestamp_ms, random_bytes)

    return uuid.UUID(bytes=uuid_bytes)


def uuidv7_timestamp(id_: uuid.UUID) -> int:
    """Extract the timestamp from a UUIDv7.

    UUIDv7 contains a 48-bit timestamp field representing milliseconds since
    the Unix epoch (1970-01-01 00:00:00 UTC). This function extracts and
    returns that timestamp as an integer representing milliseconds since the epoch.

    Args:
        id_: A UUID object that should be a UUIDv7 (version 7).

    Returns:
        The timestamp as an integer representing milliseconds since Unix epoch.

    Raises:
        ValueError: If the provided UUID is not version 7.

    Example:
        >>> uuid_v7 = uuidv7()
        >>> timestamp = uuidv7_timestamp(uuid_v7)
        >>> print(f"UUID was created at: {timestamp} ms")
    """
    # Verify this is a UUIDv7
    if id_.version != 7:
        raise ValueError(f"Expected UUIDv7 (version 7), got version {id_.version}")

    # Extract the UUID bytes
    uuid_bytes = id_.bytes

    # Extract the first 48 bits (6 bytes) as the timestamp in milliseconds
    # Pad with 2 zero bytes at the beginning to make it 8 bytes for unpacking as Q (unsigned long long)
    timestamp_bytes = b"\x00\x00" + uuid_bytes[0:6]
    ts_in_ms = struct.unpack(_PACK_TIMESTAMP, timestamp_bytes)[0]

    # Return timestamp directly in milliseconds as integer
    assert isinstance(ts_in_ms, int)
    return ts_in_ms


def uuidv7_boundary(timestamp_ms: int) -> uuid.UUID:
    """Generate a non-random uuidv7 with the given timestamp (first 48 bits) and
    all random bits to 0. As the smallest possible uuidv7 for that timestamp,
    it may be used as a boundary for partitions.
    """
    # Use zero bytes for all random portions
    zero_random_bytes = b"\x00" * 10

    # Create UUIDv7 bytes using the helper function
    uuid_bytes = _create_uuidv7_bytes(timestamp_ms, zero_random_bytes)

    return uuid.UUID(bytes=uuid_bytes)
