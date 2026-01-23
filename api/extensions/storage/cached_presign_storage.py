"""Storage wrapper that caches presigned download URLs."""

import logging
from collections.abc import Generator
from typing import Any

from extensions.storage.base_storage import BaseStorage

logger = logging.getLogger(__name__)


class CachedPresignStorage(BaseStorage):
    """Storage wrapper that caches presigned download URLs.

    Wraps a storage with presign capability and caches the generated URLs
    in Redis to reduce repeated presign API calls.

    Example:
        cached_storage = CachedPresignStorage(
            storage=FilePresignStorage(base_storage),
            redis_client=redis_client,
            cache_key_prefix="app_asset:draft_download",
        )
        url = cached_storage.get_download_url("path/to/file.txt", expires_in=3600)
    """

    TTL_BUFFER_SECONDS = 60
    MIN_TTL_SECONDS = 60

    def __init__(
        self,
        storage: BaseStorage,
        redis_client: Any,
        cache_key_prefix: str = "presign_cache",
    ):
        super().__init__()
        self._storage = storage
        self._redis = redis_client
        self._cache_key_prefix = cache_key_prefix

    def save(self, filename: str, data: bytes):
        self._storage.save(filename, data)

    def load_once(self, filename: str) -> bytes:
        return self._storage.load_once(filename)

    def load_stream(self, filename: str) -> Generator:
        return self._storage.load_stream(filename)

    def download(self, filename: str, target_filepath: str):
        self._storage.download(filename, target_filepath)

    def exists(self, filename: str) -> bool:
        return self._storage.exists(filename)

    def delete(self, filename: str):
        self._storage.delete(filename)
        self.invalidate([filename])

    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        return self._storage.scan(path, files=files, directories=directories)

    def get_upload_url(self, filename: str, expires_in: int = 3600) -> str:
        return self._storage.get_upload_url(filename, expires_in)

    def get_download_url(self, filename: str, expires_in: int = 3600) -> str:
        """Get a presigned download URL, using cache when available.

        Args:
            filename: The file path/key in storage
            expires_in: URL validity duration in seconds (default: 1 hour)

        Returns:
            Presigned URL string
        """
        cache_key = self._cache_key(filename)

        cached = self._get_cached(cache_key)
        if cached:
            return cached

        url = self._storage.get_download_url(filename, expires_in)
        self._set_cached(cache_key, url, expires_in)

        return url

    def get_download_urls(
        self,
        filenames: list[str],
        expires_in: int = 3600,
    ) -> list[str]:
        """Batch get download URLs with cache.

        Args:
            filenames: List of file paths/keys in storage
            expires_in: URL validity duration in seconds (default: 1 hour)

        Returns:
            List of presigned URLs in the same order as filenames
        """
        if not filenames:
            return []

        cache_keys = [self._cache_key(f) for f in filenames]
        cached_values = self._get_cached_batch(cache_keys)

        results: list[str] = []
        for filename, cache_key, cached in zip(filenames, cache_keys, cached_values):
            if cached:
                results.append(cached)
            else:
                url = self._storage.get_download_url(filename, expires_in)
                self._set_cached(cache_key, url, expires_in)
                results.append(url)

        return results

    def invalidate(self, filenames: list[str]) -> None:
        """Invalidate cached URLs for given filenames.

        Args:
            filenames: List of file paths/keys to invalidate
        """
        if not filenames:
            return

        cache_keys = [self._cache_key(f) for f in filenames]
        try:
            self._redis.delete(*cache_keys)
        except Exception:
            logger.warning("Failed to invalidate presign cache", exc_info=True)

    def _cache_key(self, filename: str) -> str:
        """Generate cache key for a filename."""
        return f"{self._cache_key_prefix}:{filename}"

    def _compute_ttl(self, expires_in: int) -> int:
        """Compute cache TTL from presign expiration.

        Returns TTL slightly shorter than presign expiry to ensure
        cached URLs are refreshed before they expire.
        """
        return max(expires_in - self.TTL_BUFFER_SECONDS, self.MIN_TTL_SECONDS)

    def _get_cached(self, cache_key: str) -> str | None:
        """Get a single cached URL."""
        try:
            values = self._redis.mget([cache_key])
            cached = values[0] if values else None
            if cached:
                return cached.decode("utf-8") if isinstance(cached, (bytes, bytearray)) else cached
            return None
        except Exception:
            logger.warning("Failed to read presign cache", exc_info=True)
            return None

    def _get_cached_batch(self, cache_keys: list[str]) -> list[str | None]:
        """Get multiple cached URLs."""
        try:
            cached_values = self._redis.mget(cache_keys)
            return [v.decode("utf-8") if isinstance(v, (bytes, bytearray)) else v for v in cached_values]
        except Exception:
            logger.warning("Failed to read presign cache batch", exc_info=True)
            return [None] * len(cache_keys)

    def _set_cached(self, cache_key: str, url: str, expires_in: int) -> None:
        """Store a URL in cache with computed TTL."""
        ttl = self._compute_ttl(expires_in)
        try:
            self._redis.setex(cache_key, ttl, url)
        except Exception:
            logger.warning("Failed to write presign cache", exc_info=True)
