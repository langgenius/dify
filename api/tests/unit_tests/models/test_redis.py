from extensions import ext_redis

def test_ext_redis_init() -> None:
    assert ext_redis.redis_client is not None
