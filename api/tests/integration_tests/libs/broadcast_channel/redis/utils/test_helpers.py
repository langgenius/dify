"""
Test helper utilities for Redis broadcast channel integration tests.

This module provides utility classes and functions for testing concurrent
operations, monitoring subscriptions, and measuring performance.
"""

import logging
import threading
import time
from collections.abc import Callable
from typing import Any

_logger = logging.getLogger(__name__)


class ConcurrentPublisher:
    """
    Utility class for publishing messages concurrently from multiple threads.

    This class manages multiple publisher threads that can publish messages
    to the same or different topics concurrently, useful for stress testing
    and concurrency validation.
    """

    def __init__(self, producer, message_count: int = 10, delay: float = 0.0):
        """
        Initialize the concurrent publisher.

        Args:
            producer: The producer instance to publish with
            message_count: Number of messages to publish per thread
            delay: Delay between messages in seconds
        """
        self.producer = producer
        self.message_count = message_count
        self.delay = delay
        self.threads: list[threading.Thread] = []
        self.published_messages: list[list[bytes]] = []
        self._lock = threading.Lock()
        self._started = False

    def start_publishers(self, thread_count: int = 3) -> None:
        """
        Start multiple publisher threads.

        Args:
            thread_count: Number of publisher threads to start
        """
        if self._started:
            raise RuntimeError("Publishers already started")

        self._started = True

        def _publisher(thread_id: int) -> None:
            messages: list[bytes] = []
            for i in range(self.message_count):
                message = f"thread_{thread_id}_msg_{i}".encode()
                try:
                    self.producer.publish(message)
                    messages.append(message)
                    if self.delay > 0:
                        time.sleep(self.delay)
                except Exception:
                    _logger.exception("Pubmsg=lisher %s", thread_id)

            with self._lock:
                self.published_messages.append(messages)

        for thread_id in range(thread_count):
            thread = threading.Thread(
                target=_publisher,
                args=(thread_id,),
                name=f"publisher-{thread_id}",
                daemon=True,
            )
            thread.start()
            self.threads.append(thread)

    def wait_for_completion(self, timeout: float = 30.0) -> bool:
        """
        Wait for all publisher threads to complete.

        Args:
            timeout: Maximum time to wait in seconds

        Returns:
            bool: True if all threads completed successfully
        """
        for thread in self.threads:
            thread.join(timeout)
            if thread.is_alive():
                return False
        return True

    def get_all_messages(self) -> list[bytes]:
        """
        Get all messages published by all threads.

        Returns:
            list[bytes]: Flattened list of all published messages
        """
        with self._lock:
            all_messages = []
            for thread_messages in self.published_messages:
                all_messages.extend(thread_messages)
            return all_messages

    def get_thread_messages(self, thread_id: int) -> list[bytes]:
        """
        Get messages published by a specific thread.

        Args:
            thread_id: ID of the thread

        Returns:
            list[bytes]: Messages published by the specified thread
        """
        with self._lock:
            if 0 <= thread_id < len(self.published_messages):
                return self.published_messages[thread_id].copy()
            return []


class SubscriptionMonitor:
    """
    Utility class for monitoring subscription activity in tests.

    This class monitors a subscription and tracks message reception,
    errors, and completion status for testing purposes.
    """

    def __init__(self, subscription, timeout: float = 10.0):
        """
        Initialize the subscription monitor.

        Args:
            subscription: The subscription to monitor
            timeout: Default timeout for operations
        """
        self.subscription = subscription
        self.timeout = timeout
        self.messages: list[bytes] = []
        self.errors: list[Exception] = []
        self.completed = False
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._monitor_thread: threading.Thread | None = None
        self._start_time: float | None = None

    def start_monitoring(self) -> None:
        """Start monitoring the subscription in a separate thread."""
        if self._monitor_thread is not None:
            raise RuntimeError("Monitoring already started")

        self._start_time = time.time()

        def _monitor():
            try:
                for message in self.subscription:
                    with self._lock:
                        self.messages.append(message)
                        self._condition.notify_all()
            except Exception as e:
                with self._lock:
                    self.errors.append(e)
                    self._condition.notify_all()
            finally:
                with self._lock:
                    self.completed = True
                    self._condition.notify_all()

        self._monitor_thread = threading.Thread(
            target=_monitor,
            name="subscription-monitor",
            daemon=True,
        )
        self._monitor_thread.start()

    def wait_for_messages(self, count: int, timeout: float | None = None) -> bool:
        """
        Wait for a specific number of messages.

        Args:
            count: Number of messages to wait for
            timeout: Timeout in seconds (uses default if None)

        Returns:
            bool: True if expected messages were received
        """
        if timeout is None:
            timeout = self.timeout

        deadline = time.time() + timeout

        with self._condition:
            while len(self.messages) < count and not self.completed:
                remaining = deadline - time.time()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)

            return len(self.messages) >= count

    def wait_for_completion(self, timeout: float | None = None) -> bool:
        """
        Wait for monitoring to complete.

        Args:
            timeout: Timeout in seconds (uses default if None)

        Returns:
            bool: True if monitoring completed successfully
        """
        if timeout is None:
            timeout = self.timeout

        deadline = time.time() + timeout

        with self._condition:
            while not self.completed:
                remaining = deadline - time.time()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)

            return True

    def get_messages(self) -> list[bytes]:
        """
        Get all received messages.

        Returns:
            list[bytes]: Copy of received messages
        """
        with self._lock:
            return self.messages.copy()

    def get_error_count(self) -> int:
        """
        Get the number of errors encountered.

        Returns:
            int: Number of errors
        """
        with self._lock:
            return len(self.errors)

    def get_elapsed_time(self) -> float:
        """
        Get the elapsed monitoring time.

        Returns:
            float: Elapsed time in seconds
        """
        if self._start_time is None:
            return 0.0
        return time.time() - self._start_time

    def stop(self) -> None:
        """Stop monitoring and close the subscription."""
        if self._monitor_thread is not None:
            self.subscription.close()
            self._monitor_thread.join(timeout=1.0)


def assert_message_order(received: list[bytes], expected: list[bytes]) -> bool:
    """
    Assert that messages were received in the expected order.

    Args:
        received: List of received messages
        expected: List of expected messages in order

    Returns:
        bool: True if order matches expected
    """
    if len(received) != len(expected):
        return False

    for i, (recv_msg, exp_msg) in enumerate(zip(received, expected)):
        if recv_msg != exp_msg:
            _logger.error("Message order mismatch at index %s: expected %s, got %s", i, exp_msg, recv_msg)
            return False

    return True


def measure_throughput(
    operation: Callable[[], Any],
    duration: float = 1.0,
) -> tuple[float, int]:
    """
    Measure the throughput of an operation over a specified duration.

    Args:
        operation: The operation to measure
        duration: Duration to run the operation in seconds

    Returns:
        tuple[float, int]: (operations per second, total operations)
    """
    start_time = time.time()
    end_time = start_time + duration
    count = 0

    while time.time() < end_time:
        try:
            operation()
            count += 1
        except Exception:
            _logger.exception("Operation failed")
            break

    elapsed = time.time() - start_time
    ops_per_sec = count / elapsed if elapsed > 0 else 0.0

    return ops_per_sec, count


def wait_for_condition(
    condition: Callable[[], bool],
    timeout: float = 10.0,
    interval: float = 0.1,
) -> bool:
    """
    Wait for a condition to become true.

    Args:
        condition: Function that returns True when condition is met
        timeout: Maximum time to wait in seconds
        interval: Check interval in seconds

    Returns:
        bool: True if condition was met within timeout
    """
    deadline = time.time() + timeout

    while time.time() < deadline:
        if condition():
            return True
        time.sleep(interval)

    return False


def create_stress_test_messages(
    count: int,
    size: int = 100,
) -> list[bytes]:
    """
    Create messages for stress testing.

    Args:
        count: Number of messages to create
        size: Size of each message in bytes

    Returns:
        list[bytes]: List of test messages
    """
    messages = []
    for i in range(count):
        message = f"stress_test_msg_{i:06d}_".ljust(size, "x").encode()
        messages.append(message)
    return messages


def validate_message_integrity(
    original_messages: list[bytes],
    received_messages: list[bytes],
) -> dict[str, Any]:
    """
    Validate the integrity of received messages.

    Args:
        original_messages: Messages that were sent
        received_messages: Messages that were received

    Returns:
        dict[str, Any]: Validation results
    """
    original_set = set(original_messages)
    received_set = set(received_messages)

    missing_messages = original_set - received_set
    extra_messages = received_set - original_set

    return {
        "total_sent": len(original_messages),
        "total_received": len(received_messages),
        "missing_count": len(missing_messages),
        "extra_count": len(extra_messages),
        "missing_messages": list(missing_messages),
        "extra_messages": list(extra_messages),
        "integrity_ok": len(missing_messages) == 0 and len(extra_messages) == 0,
    }
