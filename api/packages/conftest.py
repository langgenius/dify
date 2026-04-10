from unittest.mock import MagicMock

import pytest

from extensions import ext_redis


@pytest.fixture
def setup_mock_redis():
    ext_redis.redis_client.get = MagicMock(return_value=None)
    ext_redis.redis_client.set = MagicMock(return_value=None)
    mock_redis_lock = MagicMock()
    mock_redis_lock.__enter__ = MagicMock()
    mock_redis_lock.__exit__ = MagicMock()
    ext_redis.redis_client.lock = mock_redis_lock
