from redis import RedisError

from extensions.ext_redis import redis_fallback


def test_redis_fallback_success():
    @redis_fallback(default_return=None)
    def test_func():
        return "success"

    assert test_func() == "success"


def test_redis_fallback_error():
    @redis_fallback(default_return="fallback")
    def test_func():
        raise RedisError("Redis error")

    assert test_func() == "fallback"


def test_redis_fallback_none_default():
    @redis_fallback()
    def test_func():
        raise RedisError("Redis error")

    assert test_func() is None


def test_redis_fallback_with_args():
    @redis_fallback(default_return=0)
    def test_func(x, y):
        raise RedisError("Redis error")

    assert test_func(1, 2) == 0


def test_redis_fallback_with_kwargs():
    @redis_fallback(default_return={})
    def test_func(x=None, y=None):
        raise RedisError("Redis error")

    assert test_func(x=1, y=2) == {}


def test_redis_fallback_preserves_function_metadata():
    @redis_fallback(default_return=None)
    def test_func():
        """Test function docstring"""
        pass

    assert test_func.__name__ == "test_func"
    assert test_func.__doc__ == "Test function docstring"
