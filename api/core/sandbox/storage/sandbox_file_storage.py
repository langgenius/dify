"""Sandbox file storage for exporting files from sandbox environments.

This module provides storage operations for files exported from sandbox environments,
including download tickets for both runtime and archive-based file sources.

Storage key format: sandbox_file_downloads/{tenant_id}/{sandbox_id}/{export_id}/{filename}

All presign operations use the unified FilePresignStorage wrapper, which automatically
falls back to Dify's file proxy when the underlying storage doesn't support presigned URLs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from extensions.storage.base_storage import BaseStorage
from extensions.storage.cached_presign_storage import CachedPresignStorage
from extensions.storage.file_presign_storage import FilePresignStorage


@dataclass(frozen=True)
class SandboxFileDownloadPath:
    """Path for sandbox file exports."""

    tenant_id: UUID
    sandbox_id: UUID
    export_id: str
    filename: str

    def get_storage_key(self) -> str:
        return f"sandbox_file_downloads/{self.tenant_id}/{self.sandbox_id}/{self.export_id}/{self.filename}"


class SandboxFileStorage:
    """Storage operations for sandbox file exports.

    Wraps BaseStorage with:
    - FilePresignStorage for presign fallback support
    - CachedPresignStorage for URL caching

    Usage:
        storage = SandboxFileStorage(base_storage, redis_client=redis)
        storage.save(download_path, content)
        url = storage.get_download_url(download_path)
    """

    _storage: CachedPresignStorage

    def __init__(self, storage: BaseStorage, *, redis_client: Any) -> None:
        # Wrap with FilePresignStorage for fallback support, then CachedPresignStorage for caching
        presign_storage = FilePresignStorage(storage)
        self._storage = CachedPresignStorage(
            storage=presign_storage,
            redis_client=redis_client,
            cache_key_prefix="sandbox_file_downloads",
        )

    def save(self, download_path: SandboxFileDownloadPath, content: bytes) -> None:
        self._storage.save(download_path.get_storage_key(), content)

    def get_download_url(self, download_path: SandboxFileDownloadPath, expires_in: int = 3600) -> str:
        return self._storage.get_download_url(download_path.get_storage_key(), expires_in)

    def get_upload_url(self, download_path: SandboxFileDownloadPath, expires_in: int = 3600) -> str:
        return self._storage.get_upload_url(download_path.get_storage_key(), expires_in)


class _LazySandboxFileStorage:
    """Lazy initializer for singleton SandboxFileStorage.

    Delays storage initialization until first access, ensuring Flask app
    context is available.
    """

    _instance: SandboxFileStorage | None

    def __init__(self) -> None:
        self._instance = None

    def _get_instance(self) -> SandboxFileStorage:
        if self._instance is None:
            from extensions.ext_redis import redis_client
            from extensions.ext_storage import storage

            if not hasattr(storage, "storage_runner"):
                raise RuntimeError(
                    "Storage is not initialized; call storage.init_app before using sandbox_file_storage"
                )
            self._instance = SandboxFileStorage(
                storage=storage.storage_runner,
                redis_client=redis_client,
            )
        return self._instance

    def __getattr__(self, name: str):
        return getattr(self._get_instance(), name)


sandbox_file_storage: SandboxFileStorage = _LazySandboxFileStorage()  # type: ignore[assignment]
