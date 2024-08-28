import redis
from redis.connection import Connection, SSLConnection
from redis.sentinel import Sentinel


class RedisClientWrapper:
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

def init_app(app):
    global redis_client
    connection_class = Connection
    if app.config.get("REDIS_USE_SSL"):
        connection_class = SSLConnection

    redis_params = {
        "username": app.config.get("REDIS_USERNAME"),
        "password": app.config.get("REDIS_PASSWORD"),
        "db": app.config.get("REDIS_DB"),
        "encoding": "utf-8",
        "encoding_errors": "strict",
        "decode_responses": False
    }

    if app.config.get("REDIS_USE_SENTINEL"):
        sentinel_hosts = [(node.split(':')[0], int(node.split(':')[1])) for node in app.config.get("REDIS_SENTINELS").split(',')]
        sentinel = Sentinel(
            sentinel_hosts,
            sentinel_kwargs={
                "socket_timeout": app.config.get("REDIS_SENTINEL_SOCKET_TIMEOUT", 0.1),
                "username": app.config.get("REDIS_SENTINEL_USERNAME"),
                "password": app.config.get("REDIS_SENTINEL_PASSWORD")
            }
        )
        master = sentinel.master_for(
            app.config.get("REDIS_SENTINEL_SERVICE_NAME"),
            **redis_params
        )
        redis_client.initialize(master)
    else:
        redis_params.update({
            "host": app.config.get("REDIS_HOST"),
            "port": app.config.get("REDIS_PORT"),
            "connection_class": connection_class,
            })
        pool = redis.ConnectionPool(**redis_params)
        redis_client.initialize(redis.Redis(connection_pool=pool))

    app.extensions["redis"] = redis_client
