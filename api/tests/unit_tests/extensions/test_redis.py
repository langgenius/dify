from unittest.mock import patch

from redis import RedisError
from redis.retry import Retry

from extensions.ext_redis import (
    _get_base_redis_params,
    _get_cluster_connection_health_params,
    _get_connection_health_params,
    redis_fallback,
)


class TestGetConnectionHealthParams:
    @patch("extensions.ext_redis.dify_config")
    def test_includes_all_health_params(self, mock_config):
        mock_config.REDIS_RETRY_RETRIES = 3
        mock_config.REDIS_RETRY_BACKOFF_BASE = 1.0
        mock_config.REDIS_RETRY_BACKOFF_CAP = 10.0
        mock_config.REDIS_SOCKET_TIMEOUT = 5.0
        mock_config.REDIS_SOCKET_CONNECT_TIMEOUT = 5.0
        mock_config.REDIS_HEALTH_CHECK_INTERVAL = 30

        params = _get_connection_health_params()

        assert "retry" in params
        assert "socket_timeout" in params
        assert "socket_connect_timeout" in params
        assert "health_check_interval" in params
        assert isinstance(params["retry"], Retry)
        assert params["retry"]._retries == 3
        assert params["socket_timeout"] == 5.0
        assert params["socket_connect_timeout"] == 5.0
        assert params["health_check_interval"] == 30


class TestGetClusterConnectionHealthParams:
    @patch("extensions.ext_redis.dify_config")
    def test_excludes_health_check_interval(self, mock_config):
        mock_config.REDIS_RETRY_RETRIES = 3
        mock_config.REDIS_RETRY_BACKOFF_BASE = 1.0
        mock_config.REDIS_RETRY_BACKOFF_CAP = 10.0
        mock_config.REDIS_SOCKET_TIMEOUT = 5.0
        mock_config.REDIS_SOCKET_CONNECT_TIMEOUT = 5.0
        mock_config.REDIS_HEALTH_CHECK_INTERVAL = 30

        params = _get_cluster_connection_health_params()

        assert "retry" in params
        assert "socket_timeout" in params
        assert "socket_connect_timeout" in params
        assert "health_check_interval" not in params


class TestGetBaseRedisParams:
    @patch("extensions.ext_redis.dify_config")
    def test_includes_retry_and_health_params(self, mock_config):
        mock_config.REDIS_USERNAME = None
        mock_config.REDIS_PASSWORD = None
        mock_config.REDIS_DB = 0
        mock_config.REDIS_SERIALIZATION_PROTOCOL = 3
        mock_config.REDIS_ENABLE_CLIENT_SIDE_CACHE = False
        mock_config.REDIS_RETRY_RETRIES = 3
        mock_config.REDIS_RETRY_BACKOFF_BASE = 1.0
        mock_config.REDIS_RETRY_BACKOFF_CAP = 10.0
        mock_config.REDIS_SOCKET_TIMEOUT = 5.0
        mock_config.REDIS_SOCKET_CONNECT_TIMEOUT = 5.0
        mock_config.REDIS_HEALTH_CHECK_INTERVAL = 30

        params = _get_base_redis_params()

        assert "retry" in params
        assert isinstance(params["retry"], Retry)
        assert params["socket_timeout"] == 5.0
        assert params["socket_connect_timeout"] == 5.0
        assert params["health_check_interval"] == 30
        # Existing params still present
        assert params["db"] == 0
        assert params["encoding"] == "utf-8"


class TestRedisFallback:
    def test_redis_fallback_success(self):
        @redis_fallback(default_return=None)
        def test_func():
            return "success"

        assert test_func() == "success"

    def test_redis_fallback_error(self):
        @redis_fallback(default_return="fallback")
        def test_func():
            raise RedisError("Redis error")

        assert test_func() == "fallback"

    def test_redis_fallback_none_default(self):
        @redis_fallback()
        def test_func():
            raise RedisError("Redis error")

        assert test_func() is None

    def test_redis_fallback_with_args(self):
        @redis_fallback(default_return=0)
        def test_func(x, y):
            raise RedisError("Redis error")

        assert test_func(1, 2) == 0

    def test_redis_fallback_with_kwargs(self):
        @redis_fallback(default_return={})
        def test_func(x=None, y=None):
            raise RedisError("Redis error")

        assert test_func(x=1, y=2) == {}

    def test_redis_fallback_preserves_function_metadata(self):
        @redis_fallback(default_return=None)
        def test_func():
            """Test function docstring"""
            pass

        assert test_func.__name__ == "test_func"
        assert test_func.__doc__ == "Test function docstring"
