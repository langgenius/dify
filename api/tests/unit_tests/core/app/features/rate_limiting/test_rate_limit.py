import threading
import time
from datetime import timedelta
from unittest.mock import patch

import pytest

from core.app.features.rate_limiting.rate_limit import RateLimit
from core.errors.error import AppInvokeQuotaExceededError


class TestRateLimit:
    """Core rate limiting functionality tests."""

    def test_should_return_same_instance_for_same_client_id(self, redis_patch):
        """Test singleton behavior for same client ID."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
            }
        )

        rate_limit1 = RateLimit("client1", 5)
        rate_limit2 = RateLimit("client1", 10)  # Second instance with different limit

        assert rate_limit1 is rate_limit2
        # Current implementation: last constructor call overwrites max_active_requests
        # This reflects the actual behavior where __init__ always sets max_active_requests
        assert rate_limit1.max_active_requests == 10

    def test_should_create_different_instances_for_different_client_ids(self, redis_patch):
        """Test different instances for different client IDs."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
            }
        )

        rate_limit1 = RateLimit("client1", 5)
        rate_limit2 = RateLimit("client2", 10)

        assert rate_limit1 is not rate_limit2
        assert rate_limit1.client_id == "client1"
        assert rate_limit2.client_id == "client2"

    def test_should_initialize_with_valid_parameters(self, redis_patch):
        """Test normal initialization."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
            }
        )

        rate_limit = RateLimit("test_client", 5)

        assert rate_limit.client_id == "test_client"
        assert rate_limit.max_active_requests == 5
        assert hasattr(rate_limit, "initialized")
        redis_patch.setex.assert_called_once()

    def test_should_skip_initialization_if_disabled(self):
        """Test no initialization when rate limiting is disabled."""
        rate_limit = RateLimit("test_client", 0)

        assert rate_limit.disabled()
        assert not hasattr(rate_limit, "initialized")

    def test_should_skip_reinitialization_of_existing_instance(self, redis_patch):
        """Test that existing instance doesn't reinitialize."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
            }
        )

        RateLimit("client1", 5)
        redis_patch.reset_mock()

        RateLimit("client1", 10)

        redis_patch.setex.assert_not_called()

    def test_should_be_disabled_when_max_requests_is_zero_or_negative(self):
        """Test disabled state for zero or negative limits."""
        rate_limit_zero = RateLimit("client1", 0)
        rate_limit_negative = RateLimit("client2", -5)

        assert rate_limit_zero.disabled()
        assert rate_limit_negative.disabled()

    def test_should_set_redis_keys_on_first_flush(self, redis_patch):
        """Test Redis keys are set correctly on initial flush."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
            }
        )

        rate_limit = RateLimit("test_client", 5)

        expected_max_key = "dify:rate_limit:test_client:max_active_requests"
        redis_patch.setex.assert_called_with(expected_max_key, timedelta(days=1), 5)

    def test_should_sync_max_requests_from_redis_on_subsequent_flush(self, redis_patch):
        """Test max requests syncs from Redis when key exists."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": True,
                "get.return_value": b"10",
                "expire.return_value": True,
            }
        )

        rate_limit = RateLimit("test_client", 5)
        rate_limit.flush_cache()

        assert rate_limit.max_active_requests == 10

    @patch("time.time")
    def test_should_clean_timeout_requests_from_active_list(self, mock_time, redis_patch):
        """Test cleanup of timed-out requests."""
        current_time = 1000.0
        mock_time.return_value = current_time

        # Setup mock Redis with timed-out requests
        timeout_requests = {
            b"req1": str(current_time - 700).encode(),  # 700 seconds ago (timeout)
            b"req2": str(current_time - 100).encode(),  # 100 seconds ago (active)
        }

        redis_patch.configure_mock(
            **{
                "exists.return_value": True,
                "get.return_value": b"5",
                "expire.return_value": True,
                "hgetall.return_value": timeout_requests,
                "hdel.return_value": 1,
            }
        )

        rate_limit = RateLimit("test_client", 5)
        redis_patch.reset_mock()  # Reset to avoid counting initialization calls
        rate_limit.flush_cache()

        # Verify timeout request was cleaned up
        redis_patch.hdel.assert_called_once()
        call_args = redis_patch.hdel.call_args[0]
        assert call_args[0] == "dify:rate_limit:test_client:active_requests"
        assert b"req1" in call_args  # Timeout request should be removed
        assert b"req2" not in call_args  # Active request should remain


class TestRateLimitEnterExit:
    """Rate limiting enter/exit logic tests."""

    def test_should_allow_request_within_limit(self, redis_patch):
        """Test allowing requests within the rate limit."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hlen.return_value": 2,
                "hset.return_value": True,
            }
        )

        rate_limit = RateLimit("test_client", 5)
        request_id = rate_limit.enter()

        assert request_id != RateLimit._UNLIMITED_REQUEST_ID
        redis_patch.hset.assert_called_once()

    def test_should_generate_request_id_if_not_provided(self, redis_patch):
        """Test auto-generation of request ID."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hlen.return_value": 0,
                "hset.return_value": True,
            }
        )

        rate_limit = RateLimit("test_client", 5)
        request_id = rate_limit.enter()

        assert len(request_id) == 36  # UUID format

    def test_should_use_provided_request_id(self, redis_patch):
        """Test using provided request ID."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hlen.return_value": 0,
                "hset.return_value": True,
            }
        )

        rate_limit = RateLimit("test_client", 5)
        custom_id = "custom_request_123"
        request_id = rate_limit.enter(custom_id)

        assert request_id == custom_id

    def test_should_remove_request_on_exit(self, redis_patch):
        """Test request removal on exit."""
        redis_patch.configure_mock(
            **{
                "hdel.return_value": 1,
            }
        )

        rate_limit = RateLimit("test_client", 5)
        rate_limit.exit("test_request_id")

        redis_patch.hdel.assert_called_once_with("dify:rate_limit:test_client:active_requests", "test_request_id")

    def test_should_raise_quota_exceeded_when_at_limit(self, redis_patch):
        """Test quota exceeded error when at limit."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hlen.return_value": 5,  # At limit
            }
        )

        rate_limit = RateLimit("test_client", 5)

        with pytest.raises(AppInvokeQuotaExceededError) as exc_info:
            rate_limit.enter()

        assert "Too many requests" in str(exc_info.value)
        assert "test_client" in str(exc_info.value)

    def test_should_allow_request_after_previous_exit(self, redis_patch):
        """Test allowing new request after previous exit."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hlen.return_value": 4,  # Under limit after exit
                "hset.return_value": True,
                "hdel.return_value": 1,
            }
        )

        rate_limit = RateLimit("test_client", 5)

        request_id = rate_limit.enter()
        rate_limit.exit(request_id)

        new_request_id = rate_limit.enter()
        assert new_request_id is not None

    @patch("time.time")
    def test_should_flush_cache_when_interval_exceeded(self, mock_time, redis_patch):
        """Test cache flush when time interval exceeded."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hlen.return_value": 0,
            }
        )

        mock_time.return_value = 1000.0
        rate_limit = RateLimit("test_client", 5)

        # Advance time beyond flush interval
        mock_time.return_value = 1400.0  # 400 seconds later
        redis_patch.reset_mock()

        rate_limit.enter()

        # Should have called setex again due to cache flush
        redis_patch.setex.assert_called()

    def test_should_return_unlimited_id_when_disabled(self):
        """Test unlimited ID return when rate limiting disabled."""
        rate_limit = RateLimit("test_client", 0)
        request_id = rate_limit.enter()

        assert request_id == RateLimit._UNLIMITED_REQUEST_ID

    def test_should_ignore_exit_for_unlimited_requests(self, redis_patch):
        """Test ignoring exit for unlimited requests."""
        rate_limit = RateLimit("test_client", 0)
        rate_limit.exit(RateLimit._UNLIMITED_REQUEST_ID)

        redis_patch.hdel.assert_not_called()


class TestRateLimitGenerator:
    """Rate limit generator wrapper tests."""

    def test_should_wrap_generator_and_iterate_normally(self, redis_patch, sample_generator):
        """Test normal generator iteration with rate limit wrapper."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hdel.return_value": 1,
            }
        )

        rate_limit = RateLimit("test_client", 5)
        generator = sample_generator()
        request_id = "test_request"

        wrapped_gen = rate_limit.generate(generator, request_id)
        result = list(wrapped_gen)

        assert result == ["item1", "item2", "item3"]
        redis_patch.hdel.assert_called_once_with("dify:rate_limit:test_client:active_requests", request_id)

    def test_should_handle_mapping_input_directly(self, sample_mapping):
        """Test direct return of mapping input."""
        rate_limit = RateLimit("test_client", 0)  # Disabled
        result = rate_limit.generate(sample_mapping, "test_request")

        assert result is sample_mapping

    def test_should_cleanup_on_exception_during_iteration(self, redis_patch, sample_generator):
        """Test cleanup when exception occurs during iteration."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hdel.return_value": 1,
            }
        )

        rate_limit = RateLimit("test_client", 5)
        generator = sample_generator(raise_error=True)
        request_id = "test_request"

        wrapped_gen = rate_limit.generate(generator, request_id)

        with pytest.raises(ValueError):
            list(wrapped_gen)

        redis_patch.hdel.assert_called_once_with("dify:rate_limit:test_client:active_requests", request_id)

    def test_should_cleanup_on_explicit_close(self, redis_patch, sample_generator):
        """Test cleanup on explicit generator close."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hdel.return_value": 1,
            }
        )

        rate_limit = RateLimit("test_client", 5)
        generator = sample_generator()
        request_id = "test_request"

        wrapped_gen = rate_limit.generate(generator, request_id)
        wrapped_gen.close()

        redis_patch.hdel.assert_called_once()

    def test_should_handle_generator_without_close_method(self, redis_patch):
        """Test handling generator without close method."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hdel.return_value": 1,
            }
        )

        # Create a generator-like object without close method
        class SimpleGenerator:
            def __init__(self):
                self.items = ["test"]
                self.index = 0

            def __iter__(self):
                return self

            def __next__(self):
                if self.index >= len(self.items):
                    raise StopIteration
                item = self.items[self.index]
                self.index += 1
                return item

        rate_limit = RateLimit("test_client", 5)
        generator = SimpleGenerator()

        wrapped_gen = rate_limit.generate(generator, "test_request")
        wrapped_gen.close()  # Should not raise error

        redis_patch.hdel.assert_called_once()

    def test_should_prevent_iteration_after_close(self, redis_patch, sample_generator):
        """Test StopIteration after generator is closed."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hdel.return_value": 1,
            }
        )

        rate_limit = RateLimit("test_client", 5)
        generator = sample_generator()

        wrapped_gen = rate_limit.generate(generator, "test_request")
        wrapped_gen.close()

        with pytest.raises(StopIteration):
            next(wrapped_gen)


class TestRateLimitConcurrency:
    """Concurrent access safety tests."""

    def test_should_handle_concurrent_instance_creation(self, redis_patch):
        """Test thread-safe singleton instance creation."""
        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
            }
        )

        instances = []
        errors = []

        def create_instance():
            try:
                instance = RateLimit("concurrent_client", 5)
                instances.append(instance)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=create_instance) for _ in range(10)]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        assert len({id(inst) for inst in instances}) == 1  # All same instance

    def test_should_handle_concurrent_enter_requests(self, redis_patch):
        """Test concurrent enter requests handling."""
        # Setup mock to simulate realistic Redis behavior
        request_count = 0

        def mock_hlen(key):
            nonlocal request_count
            return request_count

        def mock_hset(key, field, value):
            nonlocal request_count
            request_count += 1
            return True

        redis_patch.configure_mock(
            **{
                "exists.return_value": False,
                "setex.return_value": True,
                "hlen.side_effect": mock_hlen,
                "hset.side_effect": mock_hset,
            }
        )

        rate_limit = RateLimit("concurrent_client", 3)
        results = []
        errors = []

        def try_enter():
            try:
                request_id = rate_limit.enter()
                results.append(request_id)
            except AppInvokeQuotaExceededError as e:
                errors.append(e)

        threads = [threading.Thread(target=try_enter) for _ in range(5)]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Should have some successful requests and some quota exceeded
        assert len(results) + len(errors) == 5
        assert len(errors) > 0  # Some should be rejected

    @patch("time.time")
    def test_should_maintain_accurate_count_under_load(self, mock_time, redis_patch):
        """Test accurate count maintenance under concurrent load."""
        mock_time.return_value = 1000.0

        # Use real mock_redis fixture for better simulation
        mock_client = self._create_mock_redis()
        redis_patch.configure_mock(**mock_client)

        rate_limit = RateLimit("load_test_client", 10)
        active_requests = []

        def enter_and_exit():
            try:
                request_id = rate_limit.enter()
                active_requests.append(request_id)
                time.sleep(0.01)  # Simulate some work
                rate_limit.exit(request_id)
                active_requests.remove(request_id)
            except AppInvokeQuotaExceededError:
                pass  # Expected under load

        threads = [threading.Thread(target=enter_and_exit) for _ in range(20)]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All requests should have been cleaned up
        assert len(active_requests) == 0

    def _create_mock_redis(self):
        """Create a thread-safe mock Redis for concurrency tests."""
        import threading

        lock = threading.Lock()
        data = {}
        hashes = {}

        def mock_hlen(key):
            with lock:
                return len(hashes.get(key, {}))

        def mock_hset(key, field, value):
            with lock:
                if key not in hashes:
                    hashes[key] = {}
                hashes[key][field] = str(value).encode("utf-8")
                return True

        def mock_hdel(key, *fields):
            with lock:
                if key in hashes:
                    count = 0
                    for field in fields:
                        if field in hashes[key]:
                            del hashes[key][field]
                            count += 1
                    return count
                return 0

        return {
            "exists.return_value": False,
            "setex.return_value": True,
            "hlen.side_effect": mock_hlen,
            "hset.side_effect": mock_hset,
            "hdel.side_effect": mock_hdel,
        }
