"""Shared builders for the adjacent test modules."""

import dataclasses
from unittest.mock import MagicMock


@dataclasses.dataclass(frozen=True)
class SubscriptionTestCase:
    """Test case data for subscription tests."""

    name: str
    buffer_size: int
    payload: bytes
    expected_messages: list[bytes]
    should_drop: bool = False
    description: str = ""


class FakeRedisClient:
    """Minimal fake Redis client for unit tests."""

    def __init__(self) -> None:
        self.publish = MagicMock()
        self.spublish = MagicMock()
        self.pubsub = MagicMock(return_value=MagicMock())
