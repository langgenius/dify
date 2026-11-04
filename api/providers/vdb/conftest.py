from unittest.mock import MagicMock

import pytest

from extensions import ext_redis


@pytest.fixture(autouse=True)
def _init_mock_redis():
    """Ensure redis_client has a backing client so __getattr__ never raises."""
    if ext_redis.redis_client._client is None:
        ext_redis.redis_client.initialize(MagicMock())


@pytest.fixture
def setup_mock_redis(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(ext_redis.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(ext_redis.redis_client, "set", MagicMock(return_value=None))
    mock_redis_lock = MagicMock()
    mock_redis_lock.__enter__ = MagicMock()
    mock_redis_lock.__exit__ = MagicMock()
    monkeypatch.setattr(ext_redis.redis_client, "lock", mock_redis_lock)
