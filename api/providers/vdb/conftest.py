import uuid
from unittest.mock import MagicMock

import pytest
import redis

from configs import dify_config
from extensions import ext_redis


@pytest.fixture(autouse=True)
def _init_mock_redis():
    """Ensure redis_client has a backing client so __getattr__ never raises."""
    if ext_redis.redis_client._client is None:
        ext_redis.redis_client.initialize(MagicMock())


@pytest.fixture
def setup_real_redis(monkeypatch: pytest.MonkeyPatch):
    """Use an isolated key prefix with the Redis service started for integration tests."""
    client = redis.Redis(
        host=dify_config.REDIS_HOST,
        port=dify_config.REDIS_PORT,
        username=dify_config.REDIS_USERNAME or None,
        password=dify_config.REDIS_PASSWORD or None,
        db=dify_config.REDIS_DB,
        ssl=dify_config.REDIS_USE_SSL,
        protocol=dify_config.REDIS_SERIALIZATION_PROTOCOL,
    )
    client.ping()

    key_prefix = f"pytest:vdb:{uuid.uuid4().hex}"
    previous_client = ext_redis.redis_client._client
    monkeypatch.setattr(dify_config, "REDIS_KEY_PREFIX", key_prefix)
    ext_redis.redis_client._client = client

    try:
        yield
    finally:
        try:
            keys = list(client.scan_iter(match=f"{key_prefix}:*"))
            if keys:
                client.delete(*keys)
        finally:
            try:
                client.close()
            finally:
                ext_redis.redis_client._client = previous_client
