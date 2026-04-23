import functools
import logging
import ssl
from collections.abc import Callable
from datetime import timedelta
from typing import Any, Union, cast

import redis
from redis import RedisError
from redis.backoff import ExponentialWithJitterBackoff  # type: ignore
from redis.cache import CacheConfig
from redis.client import PubSub
from redis.cluster import ClusterNode, RedisCluster
from redis.connection import Connection, SSLConnection
from redis.retry import Retry
from redis.sentinel import Sentinel
from typing_extensions import TypedDict

from configs import dify_config
from configs.middleware.cache.redis_connection_spec import (
    RedisConnectionSpec,
    build_main_redis_spec,
    build_pubsub_spec,
)
from dify_app import DifyApp
from extensions.redis_names import (
    normalize_redis_key_prefix,
    serialize_redis_name,
    serialize_redis_name_arg,
    serialize_redis_name_args,
)
from libs.broadcast_channel.channel import BroadcastChannel as BroadcastChannelProtocol
from libs.broadcast_channel.redis.channel import BroadcastChannel as RedisBroadcastChannel
from libs.broadcast_channel.redis.sharded_channel import ShardedRedisBroadcastChannel
from libs.broadcast_channel.redis.streams_channel import StreamsBroadcastChannel

logger = logging.getLogger(__name__)


_normalize_redis_key_prefix = normalize_redis_key_prefix
_serialize_redis_name = serialize_redis_name
_serialize_redis_name_arg = serialize_redis_name_arg
_serialize_redis_name_args = serialize_redis_name_args


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

    def _require_client(self) -> redis.Redis | RedisCluster:
        if self._client is None:
            raise RuntimeError("Redis client is not initialized. Call init_app first.")
        return self._client

    def _get_prefix(self) -> str:
        return dify_config.REDIS_KEY_PREFIX

    def get(self, name: str | bytes) -> Any:
        return self._require_client().get(_serialize_redis_name_arg(name, self._get_prefix()))

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
    ) -> Any:
        return self._require_client().set(
            _serialize_redis_name_arg(name, self._get_prefix()),
            value,
            ex=ex,
            px=px,
            nx=nx,
            xx=xx,
            keepttl=keepttl,
            get=get,
            exat=exat,
            pxat=pxat,
        )

    def setex(self, name: str | bytes, time: int | timedelta, value: Any) -> Any:
        return self._require_client().setex(_serialize_redis_name_arg(name, self._get_prefix()), time, value)

    def setnx(self, name: str | bytes, value: Any) -> Any:
        return self._require_client().setnx(_serialize_redis_name_arg(name, self._get_prefix()), value)

    def delete(self, *names: str | bytes) -> Any:
        return self._require_client().delete(*_serialize_redis_name_args(names, self._get_prefix()))

    def incr(self, name: str | bytes, amount: int = 1) -> Any:
        return self._require_client().incr(_serialize_redis_name_arg(name, self._get_prefix()), amount)

    def expire(
        self,
        name: str | bytes,
        time: int | timedelta,
        nx: bool = False,
        xx: bool = False,
        gt: bool = False,
        lt: bool = False,
    ) -> Any:
        return self._require_client().expire(
            _serialize_redis_name_arg(name, self._get_prefix()),
            time,
            nx=nx,
            xx=xx,
            gt=gt,
            lt=lt,
        )

    def exists(self, *names: str | bytes) -> Any:
        return self._require_client().exists(*_serialize_redis_name_args(names, self._get_prefix()))

    def ttl(self, name: str | bytes) -> Any:
        return self._require_client().ttl(_serialize_redis_name_arg(name, self._get_prefix()))

    def getdel(self, name: str | bytes) -> Any:
        return self._require_client().getdel(_serialize_redis_name_arg(name, self._get_prefix()))

    def lock(
        self,
        name: str,
        timeout: float | None = None,
        sleep: float = 0.1,
        blocking: bool = True,
        blocking_timeout: float | None = None,
        thread_local: bool = True,
    ) -> Any:
        return self._require_client().lock(
            _serialize_redis_name(name, self._get_prefix()),
            timeout=timeout,
            sleep=sleep,
            blocking=blocking,
            blocking_timeout=blocking_timeout,
            thread_local=thread_local,
        )

    def hset(self, name: str | bytes, *args: Any, **kwargs: Any) -> Any:
        return self._require_client().hset(_serialize_redis_name_arg(name, self._get_prefix()), *args, **kwargs)

    def hgetall(self, name: str | bytes) -> Any:
        return self._require_client().hgetall(_serialize_redis_name_arg(name, self._get_prefix()))

    def hdel(self, name: str | bytes, *keys: str | bytes) -> Any:
        return self._require_client().hdel(_serialize_redis_name_arg(name, self._get_prefix()), *keys)

    def hlen(self, name: str | bytes) -> Any:
        return self._require_client().hlen(_serialize_redis_name_arg(name, self._get_prefix()))

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
    ) -> Any:
        return self._require_client().zadd(
            _serialize_redis_name_arg(name, self._get_prefix()),
            cast(Any, mapping),
            nx=nx,
            xx=xx,
            ch=ch,
            incr=incr,
            gt=gt,
            lt=lt,
        )

    def zremrangebyscore(self, name: str | bytes, min: float | str, max: float | str) -> Any:
        return self._require_client().zremrangebyscore(_serialize_redis_name_arg(name, self._get_prefix()), min, max)

    def zcard(self, name: str | bytes) -> Any:
        return self._require_client().zcard(_serialize_redis_name_arg(name, self._get_prefix()))

    def pubsub(self) -> PubSub:
        return self._require_client().pubsub()

    def pipeline(self, transaction: bool = True, shard_hint: str | None = None) -> Any:
        return self._require_client().pipeline(transaction=transaction, shard_hint=shard_hint)

    def __getattr__(self, item: str) -> Any:
        return getattr(self._require_client(), item)


redis_client: RedisClientWrapper = RedisClientWrapper()
_pubsub_redis_client: redis.Redis | RedisCluster | None = None


class RedisTransportParamsDict(TypedDict):
    """Runtime tuning parameters shared across all Redis client types.

    These are business-level knobs (timeouts, retry policy, pool size,
    protocol) that don't depend on the deployment topology. They are
    read once from ``dify_config`` and passed alongside a
    ``RedisConnectionSpec`` into every client constructor.
    """

    encoding: str
    encoding_errors: str
    decode_responses: bool
    protocol: int
    cache_config: CacheConfig | None
    retry: Retry
    socket_timeout: float | None
    socket_connect_timeout: float | None
    health_check_interval: int | None
    max_connections: int | None


def _ssl_kwargs_from_spec(spec: RedisConnectionSpec) -> dict[str, Any]:
    """Map the spec's SSL fields into ``ConnectionPool``-compatible kwargs.

    Returns an empty dict when SSL is off so the caller can ``**kwargs``-
    merge unconditionally.
    """
    if not spec.use_ssl:
        return {}

    cert_reqs_map = {
        "CERT_NONE": ssl.CERT_NONE,
        "CERT_OPTIONAL": ssl.CERT_OPTIONAL,
        "CERT_REQUIRED": ssl.CERT_REQUIRED,
    }
    return {
        "ssl_cert_reqs": cert_reqs_map.get(spec.ssl_cert_reqs, ssl.CERT_NONE),
        "ssl_ca_certs": spec.ssl_ca_certs,
        "ssl_certfile": spec.ssl_certfile,
        "ssl_keyfile": spec.ssl_keyfile,
    }


def _get_cache_configuration() -> CacheConfig | None:
    """Get client-side cache configuration if enabled."""
    if not dify_config.REDIS_ENABLE_CLIENT_SIDE_CACHE:
        return None

    resp_protocol = dify_config.REDIS_SERIALIZATION_PROTOCOL
    if resp_protocol < 3:
        raise ValueError("Client side cache is only supported in RESP3")

    return CacheConfig()


def _get_retry_policy() -> Retry:
    """Build the shared retry policy for Redis connections."""
    return Retry(
        backoff=ExponentialWithJitterBackoff(
            base=dify_config.REDIS_RETRY_BACKOFF_BASE,
            cap=dify_config.REDIS_RETRY_BACKOFF_CAP,
        ),
        retries=dify_config.REDIS_RETRY_RETRIES,
    )


def _get_redis_transport_params() -> RedisTransportParamsDict:
    """Read runtime tuning params (timeouts, retry, pool size) from config.

    Does not include topology fields (host / nodes / credentials) — those
    live on the ``RedisConnectionSpec`` and are supplied separately.
    """
    return RedisTransportParamsDict(
        encoding="utf-8",
        encoding_errors="strict",
        decode_responses=False,
        protocol=dify_config.REDIS_SERIALIZATION_PROTOCOL,
        cache_config=_get_cache_configuration(),
        retry=_get_retry_policy(),
        socket_timeout=dify_config.REDIS_SOCKET_TIMEOUT,
        socket_connect_timeout=dify_config.REDIS_SOCKET_CONNECT_TIMEOUT,
        health_check_interval=dify_config.REDIS_HEALTH_CHECK_INTERVAL,
        max_connections=dify_config.REDIS_MAX_CONNECTIONS,
    )


def _create_standalone_client(
    spec: RedisConnectionSpec,
    transport: RedisTransportParamsDict,
) -> redis.Redis:
    """Build a standalone Redis client from a spec + transport params."""
    connection_class: type[Union[Connection, SSLConnection]] = SSLConnection if spec.use_ssl else Connection

    params: dict[str, Any] = {
        "host": spec.host,
        "port": spec.port,
        "username": spec.username,
        "password": spec.password,
        "db": spec.db,
        "encoding": transport["encoding"],
        "encoding_errors": transport["encoding_errors"],
        "decode_responses": transport["decode_responses"],
        "protocol": transport["protocol"],
        "cache_config": transport["cache_config"],
        "retry": transport["retry"],
        "socket_timeout": transport["socket_timeout"],
        "socket_connect_timeout": transport["socket_connect_timeout"],
        "health_check_interval": transport["health_check_interval"],
        "connection_class": connection_class,
        **_ssl_kwargs_from_spec(spec),
    }
    if transport["max_connections"]:
        params["max_connections"] = transport["max_connections"]

    pool = redis.ConnectionPool(**params)
    return redis.Redis(connection_pool=pool)


def _create_sentinel_client(
    spec: RedisConnectionSpec,
    transport: RedisTransportParamsDict,
) -> redis.Redis:
    """Build a Sentinel-aware Redis client.

    Returns a ``master_for`` handle — an implicit Redis client that
    rediscovers the current master on each connection via the Sentinel
    quorum. Callers treat it like a normal ``redis.Redis``.
    """
    # RedisConnectionSpec.__post_init__ guarantees these, but assert for the
    # type checker (sentinel_service_name is declared ``str | None``).
    assert spec.sentinel_service_name is not None

    sentinel_kwargs: dict[str, Any] = {
        "socket_timeout": spec.sentinel_socket_timeout,
        "username": spec.sentinel_username,
        "password": spec.sentinel_password,
    }
    if transport["max_connections"]:
        sentinel_kwargs["max_connections"] = transport["max_connections"]

    sentinel = Sentinel(list(spec.sentinel_nodes), sentinel_kwargs=sentinel_kwargs)

    master_params: dict[str, Any] = {
        "username": spec.username,
        "password": spec.password,
        "db": spec.db,
        "encoding": transport["encoding"],
        "encoding_errors": transport["encoding_errors"],
        "decode_responses": transport["decode_responses"],
        "protocol": transport["protocol"],
        "cache_config": transport["cache_config"],
        "retry": transport["retry"],
        "socket_timeout": transport["socket_timeout"],
        "socket_connect_timeout": transport["socket_connect_timeout"],
        "health_check_interval": transport["health_check_interval"],
    }
    return sentinel.master_for(spec.sentinel_service_name, **master_params)


def _create_cluster_client(
    spec: RedisConnectionSpec,
    transport: RedisTransportParamsDict,
) -> RedisCluster:
    """Build a Redis Cluster client.

    RedisCluster's constructor silently strips ``health_check_interval``
    (via ``cleanup_kwargs``), so we omit it here rather than have it
    passed-then-discarded.
    """
    nodes = [ClusterNode(host=host, port=port) for host, port in spec.cluster_nodes]
    cluster_kwargs: dict[str, Any] = {
        "startup_nodes": nodes,
        "password": spec.password,
        "protocol": transport["protocol"],
        "cache_config": transport["cache_config"],
        "retry": transport["retry"],
        "socket_timeout": transport["socket_timeout"],
        "socket_connect_timeout": transport["socket_connect_timeout"],
    }
    if transport["max_connections"]:
        cluster_kwargs["max_connections"] = transport["max_connections"]
    return RedisCluster(**cluster_kwargs)


def _build_main_client(spec: RedisConnectionSpec) -> Union[redis.Redis, RedisCluster]:
    """Dispatch to the right factory based on ``spec.mode``."""
    transport = _get_redis_transport_params()
    match spec.mode:
        case "sentinel":
            return _create_sentinel_client(spec, transport)
        case "cluster":
            return _create_cluster_client(spec, transport)
        case _:
            return _create_standalone_client(spec, transport)


def init_app(app: DifyApp):
    """Initialize Redis client and attach it to the app."""
    global redis_client

    # Main client: derive a spec from env, then dispatch to the right
    # factory. ``build_main_redis_spec`` rejects invalid combinations
    # (e.g. Sentinel + Cluster both enabled) up front.
    main_spec = build_main_redis_spec(dify_config)
    client = _build_main_client(main_spec)

    redis_client.initialize(client)
    app.extensions["redis"] = redis_client

    # Pub/sub client: resolve its spec relative to the main spec.
    # When the pub/sub spec equals the main spec (the default
    # "inherit" case) we reuse the main client object — essential
    # for Sentinel, where the ``master_for`` handle already
    # provides failover that a second client construction couldn't
    # inherit through a URL. When pub/sub declares its own topology
    # (via PUBSUB_REDIS_MODE or a legacy PUBSUB_REDIS_URL) we build
    # an independent client through the same factory dispatch.
    global _pubsub_redis_client
    pubsub_spec = build_pubsub_spec(main_spec, dify_config)
    if pubsub_spec == main_spec:
        _pubsub_redis_client = client
    else:
        _pubsub_redis_client = _build_main_client(pubsub_spec)


def get_pubsub_broadcast_channel() -> BroadcastChannelProtocol:
    assert _pubsub_redis_client is not None, "PubSub redis Client should be initialized here."
    if dify_config.PUBSUB_REDIS_CHANNEL_TYPE == "sharded":
        return ShardedRedisBroadcastChannel(_pubsub_redis_client)
    if dify_config.PUBSUB_REDIS_CHANNEL_TYPE == "streams":
        return StreamsBroadcastChannel(
            _pubsub_redis_client,
            retention_seconds=dify_config.PUBSUB_STREAMS_RETENTION_SECONDS,
        )
    return RedisBroadcastChannel(_pubsub_redis_client)


def redis_fallback[T](default_return: T | None = None):  # type: ignore
    """
    decorator to handle Redis operation exceptions and return a default value when Redis is unavailable.

    Args:
        default_return: The value to return when a Redis operation fails. Defaults to None.
    """

    def decorator[**P, R](func: Callable[P, R]) -> Callable[P, R | T | None]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R | T | None:
            try:
                return func(*args, **kwargs)
            except RedisError as e:
                func_name = getattr(func, "__name__", "Unknown")
                logger.warning("Redis operation failed in %s: %s", func_name, str(e), exc_info=True)
                return default_return

        return wrapper

    return decorator
