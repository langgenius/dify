"""
UUID v7 implementation for generating time-based sortable UUIDs.

UUID v7 is a time-ordered UUID that contains a Unix timestamp in milliseconds
and provides better uniqueness guarantees in high-concurrency scenarios.
"""

import os
import time
import uuid
from typing import Optional


def uuid7() -> uuid.UUID:
    """
    Generate a UUID version 7 (time-based sortable UUID).
    
    UUIDv7 format (128 bits total):
    - 48 bits: Unix timestamp in milliseconds
    - 4 bits: Version (0111 for v7)
    - 12 bits: Random data
    - 2 bits: Variant (10 for RFC 4122)
    - 62 bits: Random data
    
    Returns:
        A UUID v7 instance
    """
    # Get current timestamp in milliseconds
    timestamp_ms = int(time.time() * 1000)
    
    # Generate 80 bits of randomness using cryptographically secure random
    random_bytes = os.urandom(10)
    random_int = int.from_bytes(random_bytes, byteorder='big')
    
    # Extract the random parts
    rand_a = (random_int >> 62) & 0xFFF  # 12 bits
    rand_b = random_int & 0x3FFFFFFFFFFFFFFF  # 62 bits
    
    # Construct the 128-bit UUID value
    # Layout:
    # 0xTTTTTTTTTTTT7RRR-8RRR-RRRRRRRRRRRR
    # Where T = timestamp, 7 = version, 8 = variant (10xx), R = random
    
    uuid_int = (
        (timestamp_ms & 0xFFFFFFFFFFFF) << 80 |  # 48-bit timestamp
        0x7000 << 64 |                            # Version 7 (0111)
        (rand_a & 0xFFF) << 64 |                  # 12 random bits
        0x8000000000000000 |                      # Variant 10
        (rand_b & 0x3FFFFFFFFFFFFFFF)             # 62 random bits
    )
    
    # Create UUID from integer
    return uuid.UUID(int=uuid_int)


def uuid7_str() -> str:
    """
    Generate a UUID v7 as a string.
    
    Returns:
        A UUID v7 string in standard format (e.g., "xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx")
    """
    return str(uuid7())


def is_uuid7(uuid_val: uuid.UUID) -> bool:
    """
    Check if a UUID is version 7.
    
    Args:
        uuid_val: UUID to check
        
    Returns:
        True if the UUID is version 7, False otherwise
    """
    # Extract version bits (bits 48-51 of the UUID)
    # In the string representation, this is the first hex digit of the 3rd group
    uuid_str = str(uuid_val)
    version_char = uuid_str[14]  # Position of version in xxxxxxxx-xxxx-Vxxx-xxxx-xxxxxxxxxxxx
    return version_char == '7'


def get_timestamp_from_uuid7(uuid_val: uuid.UUID) -> Optional[float]:
    """
    Extract the timestamp from a UUID v7.
    
    Args:
        uuid_val: UUID v7 to extract timestamp from
        
    Returns:
        Timestamp in seconds as a float, or None if not a UUID v7
    """
    if not is_uuid7(uuid_val):
        return None
    
    # Extract the first 48 bits (timestamp in milliseconds)
    uuid_int = uuid_val.int
    timestamp_ms = (uuid_int >> 80) & 0xFFFFFFFFFFFF
    
    # Convert to seconds
    return timestamp_ms / 1000.0