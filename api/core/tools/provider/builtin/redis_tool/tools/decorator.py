import logging

import redis
from functools import wraps

from core.tools.errors import ToolInvokeError

KEY_PREFIX = 'dify-redis-tool:'


def redis_client_decorator(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        host = kwargs.pop('host', 'localhost')
        port = kwargs.pop('port', 6379)
        db = kwargs.pop('db', 0)
        password = kwargs.pop('password', None)
        kwargs['key'] = KEY_PREFIX + kwargs.get('key', '')

        logging.info(f"[{host}:{port}]Redis connection.")
        redis_client = redis.StrictRedis(
            host=host,
            port=port,
            db=db,
            password=password,
            decode_responses=True
        )
        try:
            result = func(redis_client, *args, **kwargs)
            return result
        except Exception as e:
            logging.error(f"[{host}:{port}]Redis invoke{func.name} error: {e}")
            raise ToolInvokeError('Failed to invoke tool')
        finally:
            redis_client.connection_pool.disconnect()
            logging.info(f"[{host}:{port}]Redis connection closed.")

    return wrapper
