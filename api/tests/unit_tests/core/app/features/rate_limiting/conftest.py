import time
from collections.abc import Callable, Generator
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest

from core.app.features.rate_limiting.rate_limit import RateLimit


@pytest.fixture
def mock_redis() -> MagicMock:
    """Mock Redis client with realistic behavior for rate limiting tests."""
    mock_client = MagicMock()

    # Redis data storage for simulation
    mock_data: dict[str, str] = {}
    mock_hashes: dict[str, dict[str, bytes]] = {}
    mock_expiry: dict[str, float] = {}

    def mock_setex(key: str, ttl: int | timedelta, value: object) -> bool:
        mock_data[key] = str(value)
        mock_expiry[key] = time.time() + (ttl.total_seconds() if isinstance(ttl, timedelta) else ttl)
        return True

    def mock_get(key: str) -> bytes | None:
        if key in mock_data and (key not in mock_expiry or time.time() < mock_expiry[key]):
            return mock_data[key].encode("utf-8")
        return None

    def mock_exists(key: str) -> bool:
        return key in mock_data or key in mock_hashes

    def mock_expire(key: str, ttl: int | timedelta) -> bool:
        if key in mock_data or key in mock_hashes:
            mock_expiry[key] = time.time() + (ttl.total_seconds() if isinstance(ttl, timedelta) else ttl)
        return True

    def mock_hset(key: str, field: str, value: object) -> bool:
        if key not in mock_hashes:
            mock_hashes[key] = {}
        mock_hashes[key][field] = str(value).encode("utf-8")
        return True

    def mock_hgetall(key: str) -> dict[str, bytes]:
        return mock_hashes.get(key, {})

    def mock_hdel(key: str, *fields: str) -> int:
        if key in mock_hashes:
            count = 0
            for field in fields:
                if field in mock_hashes[key]:
                    del mock_hashes[key][field]
                    count += 1
            return count
        return 0

    def mock_hlen(key: str) -> int:
        return len(mock_hashes.get(key, {}))

    # Configure mock methods
    mock_client.setex = mock_setex
    mock_client.get = mock_get
    mock_client.exists = mock_exists
    mock_client.expire = mock_expire
    mock_client.hset = mock_hset
    mock_client.hgetall = mock_hgetall
    mock_client.hdel = mock_hdel
    mock_client.hlen = mock_hlen

    # Store references for test verification
    mock_client._mock_data = mock_data
    mock_client._mock_hashes = mock_hashes
    mock_client._mock_expiry = mock_expiry

    return mock_client


@pytest.fixture
def mock_time() -> Generator[MagicMock]:
    """Mock time.time() for deterministic tests."""
    with patch("time.time", return_value=1000.0, autospec=True) as mock:
        yield mock


@pytest.fixture
def sample_generator() -> Callable[..., Generator[str]]:
    """Sample generator for testing RateLimitGenerator."""

    def _create_generator(items: list[str] | None = None, raise_error: bool = False) -> Generator[str]:
        items = items or ["item1", "item2", "item3"]
        for item in items:
            if raise_error and item == "item2":
                raise ValueError("Test error")
            yield item

    return _create_generator


@pytest.fixture
def sample_mapping() -> dict[str, str]:
    """Sample mapping for testing RateLimitGenerator."""
    return {"key1": "value1", "key2": "value2"}


@pytest.fixture(autouse=True)
def reset_rate_limit_instances() -> Generator[None]:
    """Clear RateLimit singleton instances between tests."""
    RateLimit._instance_dict.clear()
    yield
    RateLimit._instance_dict.clear()


@pytest.fixture
def redis_patch() -> Generator[MagicMock]:
    """Patch redis_client globally for rate limit tests."""
    with patch("core.app.features.rate_limiting.rate_limit.redis_client") as mock:
        yield mock
