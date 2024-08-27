import redis
from redis.sentinel import Sentinel
from redis.connection import Connection, SSLConnection

redis_client = redis.Redis()


def init_app(app):
    global redis_client
    connection_class = Connection
    if app.config.get("REDIS_USE_SSL"):
        connection_class = SSLConnection

    if app.config.get("REDIS_USE_SENTINEL"):
        sentinel_hosts = [(node.split(':')[0], int(node.split(':')[1])) for node in app.config.get("REDIS_SENTINELS").split(',')]
        sentinel = Sentinel(
            sentinel_hosts,
            sentinel_kwargs={
                "username": app.config.get("REDIS_SENTINEL_USERNAME"),
                "password": app.config.get("REDIS_SENTINEL_PASSWORD"),
            },
            socket_timeout=app.config.get("REDIS_SENTINEL_SOCKET_TIMEOUT", 0.1),
            connection_class=connection_class,
        )
        pool = sentinel.master_for(
            app.config.get("REDIS_SENTINEL_SERVICE_NAME"),
            db=app.config.get("REDIS_DB"),
            password=app.config.get("REDIS_PASSWORD"),
            username=app.config.get("REDIS_USERNAME"),
            encoding="utf-8",
            encoding_errors="strict",
            decode_responses=False,
        ).connection_pool
    else:
        pool = redis.ConnectionPool(
            **{
                "host": app.config.get("REDIS_HOST"),
                "port": app.config.get("REDIS_PORT"),
                "username": app.config.get("REDIS_USERNAME"),
                "password": app.config.get("REDIS_PASSWORD"),
                "db": app.config.get("REDIS_DB"),
                "encoding": "utf-8",
                "encoding_errors": "strict",
                "decode_responses": False,
            },
            connection_class=connection_class,
        )

    redis_client = Redis(connection_pool=pool)

    app.extensions["redis"] = redis_client
