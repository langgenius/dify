import redis


redis_client = redis.Redis()


def init_app(app):
    redis_client.connection_pool = redis.ConnectionPool(**{
        'host': app.config.get('REDIS_HOST', 'localhost'),
        'port': app.config.get('REDIS_PORT', 6379),
        'password': app.config.get('REDIS_PASSWORD', None),
        'db': app.config.get('REDIS_DB', 0),
        'encoding': 'utf-8',
        'encoding_errors': 'strict',
        'decode_responses': False
    })

    app.extensions['redis'] = redis_client
