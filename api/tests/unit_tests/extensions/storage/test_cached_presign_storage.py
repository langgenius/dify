from unittest.mock import Mock

import pytest

from extensions.storage.cached_presign_storage import CachedPresignStorage


class TestCachedPresignStorage:
    """Test suite for CachedPresignStorage class."""

    @pytest.fixture
    def mock_storage(self):
        """Create a mock underlying storage."""
        return Mock()

    @pytest.fixture
    def mock_redis(self):
        """Create a mock Redis client."""
        return Mock()

    @pytest.fixture
    def cached_storage(self, mock_storage):
        """Create CachedPresignStorage with mocks."""
        return CachedPresignStorage(
            storage=mock_storage,
            cache_key_prefix="test_prefix",
        )

    def test_get_download_url_returns_cached_on_hit(self, cached_storage, mock_storage, mock_redis):
        """Test that cached URL is returned when cache hit occurs."""
        mock_redis.mget.return_value = [b"https://cached-url.com/file.txt"]

        result = cached_storage.get_download_url("path/to/file.txt", expires_in=3600)

        assert result == "https://cached-url.com/file.txt"
        mock_redis.mget.assert_called_once_with(["test_prefix:path/to/file.txt"])
        mock_storage.get_download_url.assert_not_called()
        mock_redis.setex.assert_not_called()

    def test_get_download_url_calls_storage_on_miss(self, cached_storage, mock_storage, mock_redis):
        """Test that storage is called and result cached on cache miss."""
        mock_redis.mget.return_value = [None]
        mock_storage.get_download_url.return_value = "https://new-url.com/file.txt"

        result = cached_storage.get_download_url("path/to/file.txt", expires_in=3600)

        assert result == "https://new-url.com/file.txt"
        mock_redis.mget.assert_called_once_with(["test_prefix:path/to/file.txt"])
        mock_storage.get_download_url.assert_called_once_with("path/to/file.txt", 3600)
        mock_redis.setex.assert_called_once()
        call_args = mock_redis.setex.call_args
        assert call_args[0][0] == "test_prefix:path/to/file.txt"
        assert call_args[0][2] == "https://new-url.com/file.txt"

    def test_get_download_urls_batch_operation(self, cached_storage, mock_storage, mock_redis):
        """Test batch URL retrieval with mixed cache hits/misses."""
        mock_redis.mget.return_value = [b"https://cached1.com", None, b"https://cached2.com"]
        mock_storage.get_download_url.return_value = "https://new.com"

        filenames = ["file1.txt", "file2.txt", "file3.txt"]
        result = cached_storage.get_download_urls(filenames, expires_in=3600)

        assert result == ["https://cached1.com", "https://new.com", "https://cached2.com"]
        mock_storage.get_download_url.assert_called_once_with("file2.txt", 3600)
        # Verify pipeline was used for batch cache write
        mock_redis.pipeline.assert_called_once()
        mock_redis.pipeline().execute.assert_called_once()

    def test_get_download_urls_empty_list(self, cached_storage, mock_storage, mock_redis):
        """Test batch URL retrieval with empty list."""
        result = cached_storage.get_download_urls([], expires_in=3600)

        assert result == []
        mock_redis.mget.assert_not_called()
        mock_storage.get_download_url.assert_not_called()

    def test_invalidate_clears_cache(self, cached_storage, mock_redis):
        """Test that invalidate deletes the correct cache keys."""
        filenames = ["file1.txt", "file2.txt"]
        cached_storage.invalidate(filenames)

        mock_redis.delete.assert_called_once_with(
            "test_prefix:file1.txt",
            "test_prefix:file2.txt",
        )

    def test_invalidate_empty_list(self, cached_storage, mock_redis):
        """Test that invalidate does nothing for empty list."""
        cached_storage.invalidate([])

        mock_redis.delete.assert_not_called()

    def test_ttl_calculation_with_normal_expiry(self, cached_storage):
        """Test TTL is computed correctly for normal expiry values."""
        ttl = cached_storage._compute_ttl(3600)
        expected = 3600 - CachedPresignStorage.TTL_BUFFER_SECONDS
        assert ttl == expected

    def test_ttl_calculation_respects_minimum(self, cached_storage):
        """Test TTL respects minimum value for short expiry times."""
        ttl = cached_storage._compute_ttl(100)
        assert ttl == CachedPresignStorage.MIN_TTL_SECONDS

    def test_ttl_calculation_edge_case(self, cached_storage):
        """Test TTL calculation at the boundary."""
        ttl = cached_storage._compute_ttl(CachedPresignStorage.TTL_BUFFER_SECONDS + 30)
        assert ttl == CachedPresignStorage.MIN_TTL_SECONDS

    def test_graceful_degradation_on_redis_mget_error(self, cached_storage, mock_storage, mock_redis):
        """Test that storage is called when Redis mget fails."""
        mock_redis.mget.side_effect = Exception("Redis connection error")
        mock_storage.get_download_url.return_value = "https://new-url.com/file.txt"

        result = cached_storage.get_download_url("path/to/file.txt", expires_in=3600)

        assert result == "https://new-url.com/file.txt"
        mock_storage.get_download_url.assert_called_once_with("path/to/file.txt", 3600)

    def test_graceful_degradation_on_redis_setex_error(self, cached_storage, mock_storage, mock_redis):
        """Test that URL is still returned when Redis setex fails."""
        mock_redis.mget.return_value = [None]
        mock_redis.setex.side_effect = Exception("Redis connection error")
        mock_storage.get_download_url.return_value = "https://new-url.com/file.txt"

        result = cached_storage.get_download_url("path/to/file.txt", expires_in=3600)

        assert result == "https://new-url.com/file.txt"

    def test_graceful_degradation_on_redis_delete_error(self, cached_storage, mock_redis):
        """Test that invalidate doesn't raise when Redis delete fails."""
        mock_redis.delete.side_effect = Exception("Redis connection error")

        cached_storage.invalidate(["file.txt"])

    def test_delegates_save_to_storage(self, cached_storage, mock_storage):
        """Test that save delegates to underlying storage."""
        cached_storage.save("file.txt", b"data")
        mock_storage.save.assert_called_once_with("file.txt", b"data")

    def test_delegates_load_once_to_storage(self, cached_storage, mock_storage):
        """Test that load_once delegates to underlying storage."""
        mock_storage.load_once.return_value = b"content"
        result = cached_storage.load_once("file.txt")
        assert result == b"content"
        mock_storage.load_once.assert_called_once_with("file.txt")

    def test_delegates_exists_to_storage(self, cached_storage, mock_storage):
        """Test that exists delegates to underlying storage."""
        mock_storage.exists.return_value = True
        result = cached_storage.exists("file.txt")
        assert result is True
        mock_storage.exists.assert_called_once_with("file.txt")

    def test_delete_delegates_and_invalidates_cache(self, cached_storage, mock_storage, mock_redis):
        """Test that delete delegates to storage and invalidates cache."""
        cached_storage.delete("file.txt")

        mock_storage.delete.assert_called_once_with("file.txt")
        mock_redis.delete.assert_called_once_with("test_prefix:file.txt")

    def test_delegates_scan_to_storage(self, cached_storage, mock_storage):
        """Test that scan delegates to underlying storage."""
        mock_storage.scan.return_value = ["file1.txt", "file2.txt"]
        result = cached_storage.scan("path/", files=True, directories=False)
        assert result == ["file1.txt", "file2.txt"]
        mock_storage.scan.assert_called_once_with("path/", files=True, directories=False)

    def test_delegates_get_upload_url_to_storage(self, cached_storage, mock_storage):
        """Test that get_upload_url delegates to underlying storage."""
        mock_storage.get_upload_url.return_value = "https://upload-url.com"
        result = cached_storage.get_upload_url("file.txt", expires_in=3600)
        assert result == "https://upload-url.com"
        mock_storage.get_upload_url.assert_called_once_with("file.txt", 3600)

    def test_cache_key_generation(self, cached_storage):
        """Test cache key is generated correctly."""
        key = cached_storage._cache_key("path/to/file.txt")
        assert key == "test_prefix:path/to/file.txt"

    def test_cached_value_decoded_from_bytes(self, cached_storage, mock_storage, mock_redis):
        """Test that bytes cached values are decoded to strings."""
        mock_redis.mget.return_value = [b"https://cached-url.com"]

        result = cached_storage.get_download_url("file.txt")

        assert result == "https://cached-url.com"
        assert isinstance(result, str)

    def test_cached_value_decoded_from_bytearray(self, cached_storage, mock_storage, mock_redis):
        """Test that bytearray cached values are decoded to strings."""
        mock_redis.mget.return_value = [bytearray(b"https://cached-url.com")]

        result = cached_storage.get_download_url("file.txt")

        assert result == "https://cached-url.com"
        assert isinstance(result, str)

    def test_default_cache_key_prefix(self, mock_storage):
        """Test default cache key prefix is used when not specified."""
        storage = CachedPresignStorage(
            storage=mock_storage,
        )
        key = storage._cache_key("file.txt")
        assert key == "presign_cache:file.txt"
