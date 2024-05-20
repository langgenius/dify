import os
import redis
from redis.connection import Connection, SSLConnection
from redis.cluster import RedisCluster

redis_cluster_flag = os.getenv('REDIS_CLUSTER_ENABLED')
redis_username = os.getenv('REDIS_USERNAME')
redis_pwd = os.getenv('REDIS_PASSWORD')
redis_host = os.getenv('REDIS_HOST')
redis_port = os.getenv('REDIS_PORT')
if redis_cluster_flag is None or 'false' == redis_cluster_flag:
    redis_client = redis.Redis()
else:
    redis_client = RedisCluster(host=redis_host, port=redis_port, password=redis_pwd)


def init_app(app):
    global redis_client
    connection_class = Connection
    if app.config.get('REDIS_USE_SSL', False):
        connection_class = SSLConnection
    cluster_mode = app.config.get('REDIS_CLUSTER_ENABLED',False)
    if cluster_mode:
        redis_client = RedisCluster(host=app.config.get('REDIS_HOST', 'localhost'), port=app.config.get('REDIS_PORT', 6379),
                                    password=app.config.get('REDIS_PASSWORD', None))
    else:
        redis_client.connection_pool = redis.ConnectionPool(**{
            'host': app.config.get('REDIS_HOST', 'localhost'),
            'port': app.config.get('REDIS_PORT', 6379),
            'username': app.config.get('REDIS_USERNAME', None),
            'password': app.config.get('REDIS_PASSWORD', None),
            'db': app.config.get('REDIS_DB', 0),
            'encoding': 'utf-8',
            'encoding_errors': 'strict',
            'decode_responses': False
        }, connection_class=connection_class)

    app.extensions['redis'] = redis_client
