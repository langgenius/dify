import redis
from flask_caching import Cache
from redis.cluster import ClusterNode, RedisCluster
from redis.connection import Connection, SSLConnection
from redis.sentinel import Sentinel

from configs import dify_config


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
cache = Cache()


def init_app(app):
    global redis_client
    connection_class = Connection
    if dify_config.REDIS_USE_SSL:
        connection_class = SSLConnection

    redis_params = {
        "username": dify_config.REDIS_USERNAME,
        "password": dify_config.REDIS_PASSWORD,
        "db": dify_config.REDIS_DB,
        "encoding": "utf-8",
        "encoding_errors": "strict",
        "decode_responses": False,
    }

    cache_config = {
        "CACHE_TYPE": "redis",
        "CACHE_DEFAULT_TIMEOUT": 3600,
    }

    if dify_config.REDIS_USE_SENTINEL:
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
        redis_client.initialize(master)

        # Configure cache for Sentinel
        cache_config.update(
            {
                "CACHE_REDIS_URL": f"redis://{dify_config.REDIS_SENTINEL_USERNAME}:{dify_config.REDIS_SENTINEL_PASSWORD}@{sentinel_hosts[0][0]}:{sentinel_hosts[0][1]}/{dify_config.REDIS_DB}?sentinel={dify_config.REDIS_SENTINEL_SERVICE_NAME}"
            }
        )
    elif dify_config.REDIS_USE_CLUSTERS:
        nodes = [
            ClusterNode(host=node.split(":")[0], port=int(node.split(":")[1]))
            for node in dify_config.REDIS_CLUSTERS.split(",")
        ]
        redis_client.initialize(RedisCluster(startup_nodes=nodes, password=dify_config.REDIS_CLUSTERS_PASSWORD))

        # Flask-Caching doesn't directly support RedisCluster
        # Consider alternative caching libraries or a fallback
        app.logger.warning("Flask-Caching does not directly support Redis clusters. Ensure compatibility.")
        cache_config.update(
            {"CACHE_REDIS_URL": f"redis://{dify_config.REDIS_CLUSTERS.split(',')[0]}/{dify_config.REDIS_DB}"}
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
        redis_client.initialize(redis.Redis(connection_pool=pool))

        # Configure cache for standalone Redis
        cache_config.update(
            {
                "CACHE_REDIS_HOST": dify_config.REDIS_HOST,
                "CACHE_REDIS_PORT": dify_config.REDIS_PORT,
                "CACHE_REDIS_PASSWORD": dify_config.REDIS_PASSWORD,
                "CACHE_REDIS_DB": dify_config.REDIS_DB,
            }
        )

    cache.init_app(app, config=cache_config)

    app.extensions["redis"] = redis_client
