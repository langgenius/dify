from __future__ import annotations

from typing import Any

from core.sandbox.security.sandbox_file_signer import SandboxFileDownloadPath, SandboxFileSigner
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from extensions.storage.base_storage import BaseStorage
from extensions.storage.cached_presign_storage import CachedPresignStorage
from extensions.storage.silent_storage import SilentStorage


class SandboxFileStorage:
    _base_storage: BaseStorage
    _storage: CachedPresignStorage

    def __init__(self, storage: BaseStorage, *, redis_client: Any) -> None:
        self._base_storage = storage
        self._storage = CachedPresignStorage(
            storage=storage,
            redis_client=redis_client,
            cache_key_prefix="sandbox_file_downloads",
        )

    def save(self, download_path: SandboxFileDownloadPath, content: bytes) -> None:
        self._storage.save(download_path.get_storage_key(), content)

    def get_download_url(self, download_path: SandboxFileDownloadPath, expires_in: int = 3600) -> str:
        storage_key = download_path.get_storage_key()
        try:
            return self._storage.get_download_url(storage_key, expires_in)
        except NotImplementedError:
            return SandboxFileSigner.build_signed_url(
                export_path=download_path,
                expires_in=expires_in,
                action=SandboxFileSigner.OPERATION_DOWNLOAD,
            )

    def get_upload_url(self, download_path: SandboxFileDownloadPath, expires_in: int = 3600) -> str:
        storage_key = download_path.get_storage_key()
        try:
            return self._storage.get_upload_url(storage_key, expires_in)
        except NotImplementedError:
            return SandboxFileSigner.build_signed_url(
                export_path=download_path,
                expires_in=expires_in,
                action=SandboxFileSigner.OPERATION_UPLOAD,
            )


class _LazySandboxFileStorage:
    _instance: SandboxFileStorage | None

    def __init__(self) -> None:
        self._instance = None

    def _get_instance(self) -> SandboxFileStorage:
        if self._instance is None:
            if not hasattr(storage, "storage_runner"):
                raise RuntimeError(
                    "Storage is not initialized; call storage.init_app before using sandbox_file_storage"
                )
            self._instance = SandboxFileStorage(
                storage=SilentStorage(storage.storage_runner), redis_client=redis_client
            )
        return self._instance

    def __getattr__(self, name: str):
        return getattr(self._get_instance(), name)


sandbox_file_storage = _LazySandboxFileStorage()
