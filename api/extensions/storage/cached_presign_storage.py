"""Storage wrapper that caches presigned download URLs."""

import logging

from extensions.ext_redis import redis_client
from extensions.storage.base_storage import BaseStorage
from extensions.storage.storage_wrapper import StorageWrapper

logger = logging.getLogger(__name__)


class CachedPresignStorage(StorageWrapper):
    """Storage wrapper that caches presigned download URLs.

    Wraps a storage with presign capability and caches the generated URLs
    in Redis to reduce repeated presign API calls.

    Example:
        cached_storage = CachedPresignStorage(
            storage=FilePresignStorage(base_storage),
            cache_key_prefix="app_asset:draft_download",
        )
        url = cached_storage.get_download_url("path/to/file.txt", expires_in=3600)
    """

    TTL_BUFFER_SECONDS = 60
    MIN_TTL_SECONDS = 60

    def __init__(
        self,
        storage: BaseStorage,
        cache_key_prefix: str = "presign_cache",
    ):
        super().__init__(storage)
        self._redis = redis_client
        self._cache_key_prefix = cache_key_prefix

    def delete(self, filename: str):
        super().delete(filename)
        self.invalidate([filename])

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

        # Build results list, tracking which indices need fetching
        results: list[str | None] = list(cached_values)
        uncached_indices: list[int] = []
        uncached_filenames: list[str] = []

        for i, (filename, cached) in enumerate(zip(filenames, cached_values)):
            if not cached:
                uncached_indices.append(i)
                uncached_filenames.append(filename)

        # Batch fetch uncached URLs from storage
        if uncached_filenames:
            uncached_urls = [self._storage.get_download_url(f, expires_in) for f in uncached_filenames]

            # Fill results at correct positions
            for idx, url in zip(uncached_indices, uncached_urls):
                results[idx] = url

            # Batch set cache
            uncached_cache_keys = [cache_keys[i] for i in uncached_indices]
            self._set_cached_batch(uncached_cache_keys, uncached_urls, expires_in)

        return results  # type: ignore[return-value]

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

    def _set_cached_batch(self, cache_keys: list[str], urls: list[str], expires_in: int) -> None:
        """Store multiple URLs in cache with computed TTL using pipeline."""
        if not cache_keys:
            return
        ttl = self._compute_ttl(expires_in)
        try:
            pipe = self._redis.pipeline()
            for cache_key, url in zip(cache_keys, urls):
                pipe.setex(cache_key, ttl, url)
            pipe.execute()
        except Exception:
            logger.warning("Failed to write presign cache batch", exc_info=True)
