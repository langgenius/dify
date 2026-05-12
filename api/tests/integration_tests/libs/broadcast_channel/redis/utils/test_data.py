"""
Test data and configuration classes for Redis broadcast channel integration tests.

This module provides dataclasses and constants for test configurations,
message sets, and test scenarios.
"""

import dataclasses
from typing import Any

from libs.broadcast_channel.channel import Overflow


@dataclasses.dataclass(frozen=True)
class BufferTestConfig:
    """Configuration for buffer management tests."""

    buffer_size: int
    overflow_strategy: Overflow
    message_count: int
    expected_behavior: str
    description: str


@dataclasses.dataclass(frozen=True)
class ConcurrencyTestConfig:
    """Configuration for concurrency tests."""

    publisher_count: int
    subscriber_count: int
    messages_per_publisher: int
    test_duration: float
    description: str


@dataclasses.dataclass(frozen=True)
class ErrorTestConfig:
    """Configuration for error handling tests."""

    error_type: str
    test_input: Any
    expected_exception: type[Exception]
    description: str


# Test message sets for different scenarios
SMALL_MESSAGES = [
    b"msg_1",
    b"msg_2",
    b"msg_3",
    b"msg_4",
    b"msg_5",
]

MEDIUM_MESSAGES = [
    b"medium_message_1_with_more_content",
    b"medium_message_2_with_more_content",
    b"medium_message_3_with_more_content",
    b"medium_message_4_with_more_content",
    b"medium_message_5_with_more_content",
]

LARGE_MESSAGES = [
    b"large_message_" + b"x" * 1000,
    b"large_message_" + b"y" * 1000,
    b"large_message_" + b"z" * 1000,
]

VERY_LARGE_MESSAGES = [
    b"very_large_message_" + b"x" * 10000,  # ~10KB
    b"very_large_message_" + b"y" * 50000,  # ~50KB
    b"very_large_message_" + b"z" * 100000,  # ~100KB
]

SPECIAL_MESSAGES = [
    b"",  # Empty message
    b"\x00\x01\x02",  # Binary data with null bytes
    "unicode_test_你好".encode(),  # Unicode
    b"special_chars_!@#$%^&*()_+-=[]{}|;':\",./<>?",  # Special characters
    b"newlines\n\r\t",  # Control characters
]

BINARY_MESSAGES = [
    bytes(range(256)),  # All possible byte values
    b"\xff\xfe\xfd\xfc\xfb\xfa\xf9\xf8",  # High byte values
    b"\x00\x01\x02\x03\x04\x05\x06\x07",  # Low byte values
]

# Buffer test configurations
BUFFER_TEST_CONFIGS = [
    BufferTestConfig(
        buffer_size=3,
        overflow_strategy=Overflow.DROP_OLDEST,
        message_count=5,
        expected_behavior="drop_oldest",
        description="Drop oldest messages when buffer is full",
    ),
    BufferTestConfig(
        buffer_size=3,
        overflow_strategy=Overflow.DROP_NEWEST,
        message_count=5,
        expected_behavior="drop_newest",
        description="Drop newest messages when buffer is full",
    ),
    BufferTestConfig(
        buffer_size=3,
        overflow_strategy=Overflow.BLOCK,
        message_count=5,
        expected_behavior="block",
        description="Block when buffer is full",
    ),
]

# Concurrency test configurations
CONCURRENCY_TEST_CONFIGS = [
    ConcurrencyTestConfig(
        publisher_count=1,
        subscriber_count=1,
        messages_per_publisher=10,
        test_duration=5.0,
        description="Single publisher, single subscriber",
    ),
    ConcurrencyTestConfig(
        publisher_count=3,
        subscriber_count=1,
        messages_per_publisher=10,
        test_duration=5.0,
        description="Multiple publishers, single subscriber",
    ),
    ConcurrencyTestConfig(
        publisher_count=1,
        subscriber_count=3,
        messages_per_publisher=10,
        test_duration=5.0,
        description="Single publisher, multiple subscribers",
    ),
    ConcurrencyTestConfig(
        publisher_count=3,
        subscriber_count=3,
        messages_per_publisher=10,
        test_duration=5.0,
        description="Multiple publishers, multiple subscribers",
    ),
]

# Error test configurations
ERROR_TEST_CONFIGS = [
    ErrorTestConfig(
        error_type="invalid_buffer_size",
        test_input=0,
        expected_exception=ValueError,
        description="Zero buffer size should raise ValueError",
    ),
    ErrorTestConfig(
        error_type="invalid_buffer_size",
        test_input=-1,
        expected_exception=ValueError,
        description="Negative buffer size should raise ValueError",
    ),
    ErrorTestConfig(
        error_type="invalid_buffer_size",
        test_input=1.5,
        expected_exception=TypeError,
        description="Float buffer size should raise TypeError",
    ),
    ErrorTestConfig(
        error_type="invalid_buffer_size",
        test_input="invalid",
        expected_exception=TypeError,
        description="String buffer size should raise TypeError",
    ),
]

# Topic name test cases
TOPIC_NAME_TEST_CASES = [
    "simple_topic",
    "topic_with_underscores",
    "topic-with-dashes",
    "topic.with.dots",
    "topic_with_numbers_123",
    "UPPERCASE_TOPIC",
    "mixed_Case_Topic",
    "topic_with_symbols_!@#$%",
    "very_long_topic_name_" + "x" * 100,
    "unicode_topic_你好",
    "topic:with:colons",
    "topic/with/slashes",
    "topic\\with\\backslashes",
]

# Performance test configurations
PERFORMANCE_TEST_CONFIGS = [
    {
        "name": "small_messages_high_frequency",
        "message_size": 50,
        "message_count": 1000,
        "description": "Many small messages",
    },
    {
        "name": "medium_messages_medium_frequency",
        "message_size": 500,
        "message_count": 100,
        "description": "Medium messages",
    },
    {
        "name": "large_messages_low_frequency",
        "message_size": 5000,
        "message_count": 10,
        "description": "Large messages",
    },
]

# Stress test configurations
STRESS_TEST_CONFIGS = [
    {
        "name": "high_frequency_publishing",
        "publisher_count": 5,
        "messages_per_publisher": 100,
        "subscriber_count": 3,
        "description": "High frequency publishing with multiple publishers",
    },
    {
        "name": "many_subscribers",
        "publisher_count": 1,
        "messages_per_publisher": 50,
        "subscriber_count": 10,
        "description": "Many subscribers to single publisher",
    },
    {
        "name": "mixed_load",
        "publisher_count": 3,
        "messages_per_publisher": 100,
        "subscriber_count": 5,
        "description": "Mixed load with multiple publishers and subscribers",
    },
]

# Edge case test data
EDGE_CASE_MESSAGES = [
    b"",  # Empty message
    b"\x00",  # Single null byte
    b"\xff",  # Single max byte value
    b"a",  # Single ASCII character
    "ä".encode(),  # Single unicode character (2 bytes)
    "𐍈".encode(),  # Unicode character outside BMP (4 bytes)
    b"\x00" * 1000,  # 1000 null bytes
    b"\xff" * 1000,  # 1000 max byte values
]

# Message validation test data
MESSAGE_VALIDATION_TEST_CASES = [
    {
        "name": "valid_bytes",
        "input": b"valid_message",
        "should_pass": True,
        "description": "Valid bytes message",
    },
    {
        "name": "empty_bytes",
        "input": b"",
        "should_pass": True,
        "description": "Empty bytes message",
    },
    {
        "name": "binary_data",
        "input": bytes(range(256)),
        "should_pass": True,
        "description": "Binary data with all byte values",
    },
    {
        "name": "large_message",
        "input": b"x" * 1000000,  # 1MB
        "should_pass": True,
        "description": "Large message (1MB)",
    },
]

# Redis connection test scenarios
REDIS_CONNECTION_TEST_SCENARIOS = [
    {
        "name": "normal_connection",
        "should_fail": False,
        "description": "Normal Redis connection",
    },
    {
        "name": "connection_timeout",
        "should_fail": True,
        "description": "Connection timeout scenario",
    },
    {
        "name": "connection_refused",
        "should_fail": True,
        "description": "Connection refused scenario",
    },
]

# Test constants
DEFAULT_TIMEOUT = 10.0
SHORT_TIMEOUT = 2.0
LONG_TIMEOUT = 30.0

# Message size limits for testing
MAX_SMALL_MESSAGE_SIZE = 100
MAX_MEDIUM_MESSAGE_SIZE = 1000
MAX_LARGE_MESSAGE_SIZE = 10000

# Thread counts for concurrency testing
MIN_THREAD_COUNT = 1
MAX_THREAD_COUNT = 10
DEFAULT_THREAD_COUNT = 3

# Buffer sizes for testing
MIN_BUFFER_SIZE = 1
MAX_BUFFER_SIZE = 1000
DEFAULT_BUFFER_SIZE = 10
