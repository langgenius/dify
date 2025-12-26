import functools
import logging
import ssl
from collections.abc import Callable
from datetime import timedelta
from typing import TYPE_CHECKING, Any, ParamSpec, TypeVar, Union

import redis
from redis import RedisError
from redis.cache import CacheConfig
from redis.cluster import ClusterNode, RedisCluster
from redis.connection import Connection, SSLConnection
from redis.sentinel import Sentinel

from configs import dify_config
from dify_app import DifyApp

if TYPE_CHECKING:
    from redis.lock import Lock

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
        _client: The actual Redis client instance. It remains None until
                 initialized with the `initialize` method.

    Methods:
        initialize(client): Initializes the Redis client if it hasn't been initialized already.
        __getattr__(item): Delegates attribute access to the Redis client, raising an error
                           if the client is not initialized.
    """

    _client: Union[redis.Redis, RedisCluster, None]

    def __init__(self) -> None:
        self._client = None

    def initialize(self, client: Union[redis.Redis, RedisCluster]) -> None:
        if self._client is None:
            self._client = client

    if TYPE_CHECKING:
        # Type hints for IDE support and static analysis
        # These are not executed at runtime but provide type information
        def get(self, name: str | bytes) -> Any: ...

        def set(
            self,
            name: str | bytes,
            value: Any,
            ex: int | None = None,
            px: int | None = None,
            nx: bool = False,
            xx: bool = False,
            keepttl: bool = False,
            get: bool = False,
            exat: int | None = None,
            pxat: int | None = None,
        ) -> Any: ...

        def setex(self, name: str | bytes, time: int | timedelta, value: Any) -> Any: ...
        def setnx(self, name: str | bytes, value: Any) -> Any: ...
        def delete(self, *names: str | bytes) -> Any: ...
        def incr(self, name: str | bytes, amount: int = 1) -> Any: ...
        def expire(
            self,
            name: str | bytes,
            time: int | timedelta,
            nx: bool = False,
            xx: bool = False,
            gt: bool = False,
            lt: bool = False,
        ) -> Any: ...
        def lock(
            self,
            name: str,
            timeout: float | None = None,
            sleep: float = 0.1,
            blocking: bool = True,
            blocking_timeout: float | None = None,
            thread_local: bool = True,
        ) -> Lock: ...
        def zadd(
            self,
            name: str | bytes,
            mapping: dict[str | bytes | int | float, float | int | str | bytes],
            nx: bool = False,
            xx: bool = False,
            ch: bool = False,
            incr: bool = False,
            gt: bool = False,
            lt: bool = False,
        ) -> Any: ...
        def zremrangebyscore(self, name: str | bytes, min: float | str, max: float | str) -> Any: ...
        def zcard(self, name: str | bytes) -> Any: ...
        def getdel(self, name: str | bytes) -> Any: ...

    def __getattr__(self, item: str) -> Any:
        if self._client is None:
            raise RuntimeError("Redis client is not initialized. Call init_app first.")
        return getattr(self._client, item)


redis_client: RedisClientWrapper = RedisClientWrapper()


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


P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T")


def redis_fallback(default_return: T | None = None):  # type: ignore
    """
    decorator to handle Redis operation exceptions and return a default value when Redis is unavailable.

    Args:
        default_return: The value to return when a Redis operation fails. Defaults to None.
    """

    def decorator(func: Callable[P, R]):
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs):
            try:
                return func(*args, **kwargs)
            except RedisError as e:
                func_name = getattr(func, "__name__", "Unknown")
                logger.warning("Redis operation failed in %s: %s", func_name, str(e), exc_info=True)
                return default_return

        return wrapper

    return decorator
