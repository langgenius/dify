import os
import uuid
from unittest.mock import MagicMock

import pytest
import redis

from configs import DifyConfig, dify_config
from extensions import ext_redis


@pytest.fixture(autouse=True)
def _init_mock_redis():
    """Ensure redis_client has a backing client so __getattr__ never raises."""
    if ext_redis.redis_client._client is None:
        ext_redis.redis_client.initialize(MagicMock())


@pytest.fixture
def setup_real_redis(monkeypatch: pytest.MonkeyPatch):
    """Use selected test env files and an isolated key prefix for integration Redis."""
    env_files = [os.environ["DIFY_TEST_ENV_FILE"]]
    if vdb_env_file := os.environ.get("DIFY_VDB_TEST_ENV_FILE"):
        env_files.append(vdb_env_file)
    redis_config = DifyConfig(_env_file=env_files)
    pool = redis.ConnectionPool(
        connection_class=redis.SSLConnection if redis_config.REDIS_USE_SSL else redis.Connection,
        host=redis_config.REDIS_HOST,
        port=redis_config.REDIS_PORT,
        username=redis_config.REDIS_USERNAME or None,
        password=redis_config.REDIS_PASSWORD or None,
        db=redis_config.REDIS_DB,
        protocol=redis_config.REDIS_SERIALIZATION_PROTOCOL,
    )
    client = redis.Redis(connection_pool=pool)
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
                try:
                    pool.disconnect()
                finally:
                    ext_redis.redis_client._client = previous_client
