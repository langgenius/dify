"""Archive-based sandbox storage for persisting sandbox state."""

from __future__ import annotations

import logging

from core.virtual_environment.__base.exec import PipelineExecutionError
from core.virtual_environment.__base.helpers import pipeline
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from extensions.storage.base_storage import BaseStorage
from extensions.storage.cached_presign_storage import CachedPresignStorage
from extensions.storage.file_presign_storage import FilePresignStorage

from .sandbox_storage import SandboxStorage

logger = logging.getLogger(__name__)

_ARCHIVE_TIMEOUT = 300  # 5 minutes


class ArchiveSandboxStorage(SandboxStorage):
    """Archive-based storage for sandbox workspace persistence."""

    def __init__(
        self,
        tenant_id: str,
        sandbox_id: str,
        storage: BaseStorage,
        exclude_patterns: list[str] | None = None,
    ):
        self._sandbox_id = sandbox_id
        self._exclude_patterns = exclude_patterns or []
        self._storage_key = f"sandbox_archives/{tenant_id}/{sandbox_id}.tar.gz"
        self._storage = CachedPresignStorage(
            storage=FilePresignStorage(storage),
            cache_key_prefix="sandbox_archives",
        )

    def mount(self, sandbox: VirtualEnvironment) -> bool:
        """Load archive from storage into sandbox workspace."""
        if not self.exists():
            logger.debug("No archive found for sandbox %s, skipping mount", self._sandbox_id)
            return False

        download_url = self._storage.get_download_url(self._storage_key, _ARCHIVE_TIMEOUT)
        archive = "archive.tar.gz"

        try:
            (
                pipeline(sandbox)
                .add(["curl", "-fsSL", download_url, "-o", archive], error_message="Failed to download archive")
                .add(
                    ["sh", "-c", 'tar -xzf "$1" 2>/dev/null; exit $?', "sh", archive], error_message="Failed to extract"
                )
                .add(["rm", archive], error_message="Failed to cleanup")
                .execute(timeout=_ARCHIVE_TIMEOUT, raise_on_error=True)
            )
        except PipelineExecutionError:
            logger.exception("Failed to mount archive for sandbox %s", self._sandbox_id)
            return False

        logger.info("Mounted archive for sandbox %s", self._sandbox_id)
        return True

    def unmount(self, sandbox: VirtualEnvironment) -> bool:
        """Save sandbox workspace to storage as archive."""
        upload_url = self._storage.get_upload_url(self._storage_key, _ARCHIVE_TIMEOUT)
        archive = f"/tmp/{self._sandbox_id}.tar.gz"
        exclude_args = [f"--exclude={p}" for p in self._exclude_patterns]

        (
            pipeline(sandbox)
            .add(["tar", "-czf", archive, *exclude_args, "-C", ".", "."], error_message="Failed to create archive")
            .add(["curl", "-sf", "-X", "PUT", "-T", archive, upload_url], error_message="Failed to upload archive")
            .execute(timeout=_ARCHIVE_TIMEOUT, raise_on_error=True)
        )
        logger.info("Unmounted archive for sandbox %s", self._sandbox_id)
        return True

    def exists(self) -> bool:
        return self._storage.exists(self._storage_key)

    def delete(self) -> None:
        try:
            self._storage.delete(self._storage_key)
            logger.info("Deleted archive for sandbox %s", self._sandbox_id)
        except Exception:
            logger.exception("Failed to delete archive for sandbox %s", self._sandbox_id)
