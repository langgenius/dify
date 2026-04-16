from unittest.mock import MagicMock, patch

from redis import RedisError
from redis.retry import Retry

from extensions.ext_redis import (
    RedisClientWrapper,
    _get_base_redis_params,
    _get_cluster_connection_health_params,
    _get_connection_health_params,
    _normalize_redis_key_prefix,
    _serialize_redis_name,
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


class TestRedisKeyPrefixHelpers:
    def test_normalize_redis_key_prefix_trims_whitespace(self):
        assert _normalize_redis_key_prefix("  enterprise-a  ") == "enterprise-a"

    def test_normalize_redis_key_prefix_treats_whitespace_only_as_empty(self):
        assert _normalize_redis_key_prefix("   ") == ""

    def test_serialize_redis_name_returns_original_when_prefix_empty(self):
        assert _serialize_redis_name("model_lb_index:test", "") == "model_lb_index:test"

    def test_serialize_redis_name_adds_single_colon_separator(self):
        assert _serialize_redis_name("model_lb_index:test", "enterprise-a") == "enterprise-a:model_lb_index:test"


class TestRedisClientWrapperKeyPrefix:
    def test_wrapper_get_prefixes_string_keys(self):
        mock_client = MagicMock()
        wrapper = RedisClientWrapper()
        wrapper.initialize(mock_client)

        with patch("extensions.ext_redis.dify_config") as mock_config:
            mock_config.REDIS_KEY_PREFIX = "enterprise-a"

            wrapper.get("oauth_state:abc")

        mock_client.get.assert_called_once_with("enterprise-a:oauth_state:abc")

    def test_wrapper_delete_prefixes_multiple_keys(self):
        mock_client = MagicMock()
        wrapper = RedisClientWrapper()
        wrapper.initialize(mock_client)

        with patch("extensions.ext_redis.dify_config") as mock_config:
            mock_config.REDIS_KEY_PREFIX = "enterprise-a"

            wrapper.delete("key:a", "key:b")

        mock_client.delete.assert_called_once_with("enterprise-a:key:a", "enterprise-a:key:b")

    def test_wrapper_lock_prefixes_lock_name(self):
        mock_client = MagicMock()
        wrapper = RedisClientWrapper()
        wrapper.initialize(mock_client)

        with patch("extensions.ext_redis.dify_config") as mock_config:
            mock_config.REDIS_KEY_PREFIX = "enterprise-a"

            wrapper.lock("resource-lock", timeout=10)

        mock_client.lock.assert_called_once()
        args, kwargs = mock_client.lock.call_args
        assert args == ("enterprise-a:resource-lock",)
        assert kwargs["timeout"] == 10

    def test_wrapper_hash_operations_prefix_key_name(self):
        mock_client = MagicMock()
        wrapper = RedisClientWrapper()
        wrapper.initialize(mock_client)

        with patch("extensions.ext_redis.dify_config") as mock_config:
            mock_config.REDIS_KEY_PREFIX = "enterprise-a"

            wrapper.hset("hash:key", "field", "value")
            wrapper.hgetall("hash:key")

        mock_client.hset.assert_called_once_with("enterprise-a:hash:key", "field", "value")
        mock_client.hgetall.assert_called_once_with("enterprise-a:hash:key")

    def test_wrapper_zadd_prefixes_sorted_set_name(self):
        mock_client = MagicMock()
        wrapper = RedisClientWrapper()
        wrapper.initialize(mock_client)

        with patch("extensions.ext_redis.dify_config") as mock_config:
            mock_config.REDIS_KEY_PREFIX = "enterprise-a"

            wrapper.zadd("zset:key", {"member": 1})

        mock_client.zadd.assert_called_once()
        args, kwargs = mock_client.zadd.call_args
        assert args == ("enterprise-a:zset:key", {"member": 1})
        assert kwargs["nx"] is False

    def test_wrapper_preserves_keys_when_prefix_is_empty(self):
        mock_client = MagicMock()
        wrapper = RedisClientWrapper()
        wrapper.initialize(mock_client)

        with patch("extensions.ext_redis.dify_config") as mock_config:
            mock_config.REDIS_KEY_PREFIX = "   "

            wrapper.get("plain:key")

        mock_client.get.assert_called_once_with("plain:key")
