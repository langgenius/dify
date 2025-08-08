import functools
import logging
import ssl
from collections.abc import Callable
from typing import Any, Union

import redis
from redis import RedisError
from redis.cache import CacheConfig
from redis.cluster import ClusterNode, RedisCluster
from redis.connection import Connection, SSLConnection
from redis.sentinel import Sentinel

from configs import dify_config
from dify_app import DifyApp

logger = logging.getLogger(__name__)


class RedisClientWrapper:
    """
    A wrapper class for the Redis client that addresses the issue where the global
    `redis_client` variable cannot be updated when a new Redis instance is returned
    by Sentinel.

    This class allows for deferred initialization of the Redis client, enabling the
    client to be re-initialized with a new instance when necessary. This is particularly
    useful in scenarios where the Redis instance may change dynamically, such as during
    a failover in a Sentinel-managed Redis setup.

    Attributes:
        _client (redis.Redis): The actual Redis client instance. It remains None until
                               initialized with the `initialize` method.

    Methods:
        initialize(client): Initializes the Redis client if it hasn't been initialized already.
        __getattr__(item): Delegates attribute access to the Redis client, raising an error
                           if the client is not initialized.
    """

    def __init__(self):
        self._client = None

    def initialize(self, client):
        if self._client is None:
            self._client = client

    def __getattr__(self, item):
        if self._client is None:
            raise RuntimeError("Redis client is not initialized. Call init_app first.")
        return getattr(self._client, item)


redis_client = RedisClientWrapper()


def _get_ssl_configuration() -> tuple[type[Union[Connection, SSLConnection]], dict[str, Any]]:
    """Get SSL configuration for Redis connection."""
    if not dify_config.REDIS_USE_SSL:
        return Connection, {}

    cert_reqs_map = {
        "CERT_NONE": ssl.CERT_NONE,
        "CERT_OPTIONAL": ssl.CERT_OPTIONAL,
        "CERT_REQUIRED": ssl.CERT_REQUIRED,
    }
    ssl_cert_reqs = cert_reqs_map.get(dify_config.REDIS_SSL_CERT_REQS, ssl.CERT_NONE)

    ssl_kwargs = {
        "ssl_cert_reqs": ssl_cert_reqs,
        "ssl_ca_certs": dify_config.REDIS_SSL_CA_CERTS,
        "ssl_certfile": dify_config.REDIS_SSL_CERTFILE,
        "ssl_keyfile": dify_config.REDIS_SSL_KEYFILE,
    }

    return SSLConnection, ssl_kwargs


def _get_cache_configuration() -> CacheConfig | None:
    """Get client-side cache configuration if enabled."""
    if not dify_config.REDIS_ENABLE_CLIENT_SIDE_CACHE:
        return None

    resp_protocol = dify_config.REDIS_SERIALIZATION_PROTOCOL
    if resp_protocol < 3:
        raise ValueError("Client side cache is only supported in RESP3")

    return CacheConfig()


def _get_base_redis_params() -> dict[str, Any]:
    """Get base Redis connection parameters."""
    return {
        "username": dify_config.REDIS_USERNAME,
        "password": dify_config.REDIS_PASSWORD or None,
        "db": dify_config.REDIS_DB,
        "encoding": "utf-8",
        "encoding_errors": "strict",
        "decode_responses": False,
        "protocol": dify_config.REDIS_SERIALIZATION_PROTOCOL,
        "cache_config": _get_cache_configuration(),
    }


def _create_sentinel_client(redis_params: dict[str, Any]) -> Union[redis.Redis, RedisCluster]:
    """Create Redis client using Sentinel configuration."""
    if not dify_config.REDIS_SENTINELS:
        raise ValueError("REDIS_SENTINELS must be set when REDIS_USE_SENTINEL is True")

    if not dify_config.REDIS_SENTINEL_SERVICE_NAME:
        raise ValueError("REDIS_SENTINEL_SERVICE_NAME must be set when REDIS_USE_SENTINEL is True")

    sentinel_hosts = [(node.split(":")[0], int(node.split(":")[1])) for node in dify_config.REDIS_SENTINELS.split(",")]

    sentinel = Sentinel(
        sentinel_hosts,
        sentinel_kwargs={
            "socket_timeout": dify_config.REDIS_SENTINEL_SOCKET_TIMEOUT,
            "username": dify_config.REDIS_SENTINEL_USERNAME,
            "password": dify_config.REDIS_SENTINEL_PASSWORD,
        },
    )

    master: redis.Redis = sentinel.master_for(dify_config.REDIS_SENTINEL_SERVICE_NAME, **redis_params)
    return master


def _create_cluster_client() -> Union[redis.Redis, RedisCluster]:
    """Create Redis cluster client."""
    if not dify_config.REDIS_CLUSTERS:
        raise ValueError("REDIS_CLUSTERS must be set when REDIS_USE_CLUSTERS is True")

    nodes = [
        ClusterNode(host=node.split(":")[0], port=int(node.split(":")[1]))
        for node in dify_config.REDIS_CLUSTERS.split(",")
    ]

    cluster: RedisCluster = RedisCluster(
        startup_nodes=nodes,
        password=dify_config.REDIS_CLUSTERS_PASSWORD,
        protocol=dify_config.REDIS_SERIALIZATION_PROTOCOL,
        cache_config=_get_cache_configuration(),
    )
    return cluster


def _create_standalone_client(redis_params: dict[str, Any]) -> Union[redis.Redis, RedisCluster]:
    """Create standalone Redis client."""
    connection_class, ssl_kwargs = _get_ssl_configuration()

    redis_params.update(
        {
            "host": dify_config.REDIS_HOST,
            "port": dify_config.REDIS_PORT,
            "connection_class": connection_class,
        }
    )

    if ssl_kwargs:
        redis_params.update(ssl_kwargs)

    pool = redis.ConnectionPool(**redis_params)
    client: redis.Redis = redis.Redis(connection_pool=pool)
    return client


def init_app(app: DifyApp):
    """Initialize Redis client and attach it to the app."""
    global redis_client

    # Determine Redis mode and create appropriate client
    if dify_config.REDIS_USE_SENTINEL:
        redis_params = _get_base_redis_params()
        client = _create_sentinel_client(redis_params)
    elif dify_config.REDIS_USE_CLUSTERS:
        client = _create_cluster_client()
    else:
        redis_params = _get_base_redis_params()
        client = _create_standalone_client(redis_params)

    # Initialize the wrapper and attach to app
    redis_client.initialize(client)
    app.extensions["redis"] = redis_client


def redis_fallback(default_return: Any = None):
    """
    decorator to handle Redis operation exceptions and return a default value when Redis is unavailable.

    Args:
        default_return: The value to return when a Redis operation fails. Defaults to None.
    """

    def decorator(func: Callable):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except RedisError as e:
                logger.warning("Redis operation failed in %s: %s", func.__name__, str(e), exc_info=True)
                return default_return

        return wrapper

    return decorator
