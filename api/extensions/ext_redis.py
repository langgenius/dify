import functools
from typing import Any, Callable, Generic, TypeVar, Union

import redis
from redis.cluster import ClusterNode, RedisCluster
from redis.connection import Connection, SSLConnection
from redis.sentinel import Sentinel

from configs import dify_config
from dify_app import DifyApp

T = TypeVar("T")


class KeyPrefixMethodProxy(Generic[T]):
    """
    KeyPrefixMethodProxy is a generic class used to proxy method calls.
    It can preprocess parameters before calling a method, such as prefixing specific keys.
    Key features include:
    If a method's argument contains'key', prefix it.
    If the method's positional parameter contains a key of type string, prefix it.
    """

    def __init__(self, client: T, prefix: str):
        self._client = client
        self._prefix = prefix

    def __getattr__(self, item):
        attr = getattr(self._client, item)
        if callable(attr):
            return self._wrap_method(attr)
        return attr

    def _wrap_method(self, method: Callable) -> Callable:
        @functools.wraps(method)
        def wrapper(*args, **kwargs):
            if "key" in kwargs:
                if isinstance(kwargs["key"], str):
                    kwargs["key"] = self._add_prefix(kwargs["key"])
            elif args:
                if args and isinstance(args[0], str):
                    args = (self._add_prefix(args[0]),) + args[1:]
            return method(*args, **kwargs)

        return wrapper

    def _add_prefix(self, key: str) -> str:
        return f"{self._prefix}:{key}" if self._prefix else key


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
        self._prefix = None

    def initialize(self, client, prefix=None):
        if self._client is None:
            self._client = client
        if prefix is not None:
            self._prefix = prefix

    def __getattr__(self, item):
        if self._client is None:
            raise RuntimeError("Redis client is not initialized. Call init_app first.")
        if self._prefix is not None:
            return getattr(KeyPrefixMethodProxy(self._client, self._prefix), item)
        return getattr(self._client, item)


redis_client = RedisClientWrapper()


def init_app(app: DifyApp):
    global redis_client
    connection_class: type[Union[Connection, SSLConnection]] = Connection
    if dify_config.REDIS_USE_SSL:
        connection_class = SSLConnection

    redis_params: dict[str, Any] = {
        "username": dify_config.REDIS_USERNAME,
        "password": dify_config.REDIS_PASSWORD or None,  # Temporary fix for empty password
        "db": dify_config.REDIS_DB,
        "encoding": "utf-8",
        "encoding_errors": "strict",
        "decode_responses": False,
    }

    if dify_config.REDIS_USE_SENTINEL:
        assert dify_config.REDIS_SENTINELS is not None, "REDIS_SENTINELS must be set when REDIS_USE_SENTINEL is True"
        sentinel_hosts = [
            (node.split(":")[0], int(node.split(":")[1])) for node in dify_config.REDIS_SENTINELS.split(",")
        ]
        sentinel = Sentinel(
            sentinel_hosts,
            sentinel_kwargs={
                "socket_timeout": dify_config.REDIS_SENTINEL_SOCKET_TIMEOUT,
                "username": dify_config.REDIS_SENTINEL_USERNAME,
                "password": dify_config.REDIS_SENTINEL_PASSWORD,
            },
        )
        master = sentinel.master_for(dify_config.REDIS_SENTINEL_SERVICE_NAME, **redis_params)
        redis_client.initialize(master, prefix=dify_config.REDIS_KEY_PREFIX)
    elif dify_config.REDIS_USE_CLUSTERS:
        assert dify_config.REDIS_CLUSTERS is not None, "REDIS_CLUSTERS must be set when REDIS_USE_CLUSTERS is True"
        nodes = [
            ClusterNode(host=node.split(":")[0], port=int(node.split(":")[1]))
            for node in dify_config.REDIS_CLUSTERS.split(",")
        ]
        # FIXME: mypy error here, try to figure out how to fix it
        redis_client.initialize(
            RedisCluster(startup_nodes=nodes, password=dify_config.REDIS_CLUSTERS_PASSWORD),  # type: ignore
            prefix=dify_config.REDIS_KEY_PREFIX,
        )
    else:
        redis_params.update(
            {
                "host": dify_config.REDIS_HOST,
                "port": dify_config.REDIS_PORT,
                "connection_class": connection_class,
            }
        )
        pool = redis.ConnectionPool(**redis_params)
        redis_client.initialize(redis.Redis(connection_pool=pool), prefix=dify_config.REDIS_KEY_PREFIX)

    app.extensions["redis"] = redis_client
