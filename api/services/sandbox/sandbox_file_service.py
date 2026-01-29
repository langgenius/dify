from __future__ import annotations

from core.sandbox.entities.files import SandboxFileDownloadTicket, SandboxFileNode
from core.sandbox.inspector import SandboxFileBrowser
from extensions.ext_storage import storage
from extensions.storage.cached_presign_storage import CachedPresignStorage
from extensions.storage.file_presign_storage import FilePresignStorage


class SandboxFileService:
    @staticmethod
    def get_storage() -> CachedPresignStorage:
        """Get a lazily-initialized storage instance for sandbox files.

        Returns a CachedPresignStorage wrapping FilePresignStorage,
        providing presign fallback and URL caching.
        """
        return CachedPresignStorage(
            storage=FilePresignStorage(storage.storage_runner),
            cache_key_prefix="sandbox_files",
        )

    @classmethod
    def list_files(
        cls,
        *,
        tenant_id: str,
        sandbox_id: str,
        path: str | None = None,
        recursive: bool = False,
    ) -> list[SandboxFileNode]:
        browser = SandboxFileBrowser(tenant_id=tenant_id, sandbox_id=sandbox_id)
        return browser.list_files(path=path, recursive=recursive)

    @classmethod
    def download_file(cls, *, tenant_id: str, sandbox_id: str, path: str) -> SandboxFileDownloadTicket:
        browser = SandboxFileBrowser(tenant_id=tenant_id, sandbox_id=sandbox_id)
        return browser.download_file(path=path)
