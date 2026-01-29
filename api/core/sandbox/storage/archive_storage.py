"""Archive-based sandbox storage for persisting sandbox state.

This module provides storage operations for sandbox workspace archives (tar.gz),
enabling state persistence across sandbox sessions.

Storage key format: sandbox_archives/{tenant_id}/{sandbox_id}.tar.gz

All presign operations use the unified FilePresignStorage wrapper, which automatically
falls back to Dify's file proxy when the underlying storage doesn't support presigned URLs.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from core.virtual_environment.__base.exec import PipelineExecutionError
from core.virtual_environment.__base.helpers import pipeline
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from extensions.storage.base_storage import BaseStorage
from extensions.storage.cached_presign_storage import CachedPresignStorage
from extensions.storage.file_presign_storage import FilePresignStorage
from extensions.storage.silent_storage import SilentStorage

from .sandbox_storage import SandboxStorage

logger = logging.getLogger(__name__)

WORKSPACE_DIR = "."
ARCHIVE_DOWNLOAD_TIMEOUT = 60 * 5
ARCHIVE_UPLOAD_TIMEOUT = 60 * 5


def build_tar_exclude_args(patterns: list[str]) -> list[str]:
    return [f"--exclude={p}" for p in patterns]


@dataclass(frozen=True)
class SandboxArchivePath:
    """Path for sandbox workspace archives."""

    tenant_id: UUID
    sandbox_id: UUID

    def get_storage_key(self) -> str:
        return f"sandbox_archives/{self.tenant_id}/{self.sandbox_id}.tar.gz"


class ArchiveSandboxStorage(SandboxStorage):
    """Archive-based storage for sandbox workspace persistence.

    Uses tar.gz archives to save and restore sandbox workspace state.
    Requires a presign-capable storage wrapper for generating download/upload URLs.
    """

    _tenant_id: str
    _sandbox_id: str
    _exclude_patterns: list[str]
    _storage: BaseStorage

    def __init__(
        self,
        tenant_id: str,
        sandbox_id: str,
        storage: BaseStorage,
        exclude_patterns: list[str] | None = None,
    ):
        self._tenant_id = tenant_id
        self._sandbox_id = sandbox_id
        self._exclude_patterns = exclude_patterns or []
        # Wrap with FilePresignStorage for presign fallback support
        self._storage = CachedPresignStorage(
            storage=FilePresignStorage(SilentStorage(storage)),
            cache_key_prefix="sandbox_archives",
        )

    @property
    def _archive_path(self) -> SandboxArchivePath:
        return SandboxArchivePath(UUID(self._tenant_id), UUID(self._sandbox_id))

    @property
    def _storage_key(self) -> str:
        return self._archive_path.get_storage_key()

    @property
    def _archive_name(self) -> str:
        return f"{self._sandbox_id}.tar.gz"

    @property
    def _archive_tmp_path(self) -> str:
        return f"/tmp/{self._archive_name}"

    def mount(self, sandbox: VirtualEnvironment) -> bool:
        """Load archive from storage into sandbox workspace."""
        if not self.exists():
            logger.debug("No archive found for sandbox %s, skipping mount", self._sandbox_id)
            return False

        download_url = self._storage.get_download_url(self._storage_key, ARCHIVE_DOWNLOAD_TIMEOUT)
        archive_name = self._archive_name

        try:
            (
                pipeline(sandbox)
                .add(["curl", "-fsSL", download_url, "-o", archive_name], error_message="Failed to download archive")
                .add(
                    ["sh", "-c", 'tar -xzf "$1" 2>/dev/null; exit $?', "sh", archive_name],
                    error_message="Failed to extract archive",
                )
                .add(["rm", archive_name], error_message="Failed to cleanup archive")
                .execute(timeout=ARCHIVE_DOWNLOAD_TIMEOUT, raise_on_error=True)
            )
        except PipelineExecutionError:
            logger.exception("Failed to extract archive")
            return False

        logger.info("Mounted archive for sandbox %s", self._sandbox_id)
        return True

    def unmount(self, sandbox: VirtualEnvironment) -> bool:
        """Save sandbox workspace to storage as archive."""
        upload_url = self._storage.get_upload_url(self._storage_key, ARCHIVE_UPLOAD_TIMEOUT)
        archive_path = self._archive_tmp_path

        (
            pipeline(sandbox)
            .add(
                [
                    "tar",
                    "-czf",
                    archive_path,
                    *build_tar_exclude_args(self._exclude_patterns),
                    "-C",
                    WORKSPACE_DIR,
                    ".",
                ],
                error_message="Failed to create archive",
            )
            .add(
                ["curl", "-s", "-f", "-X", "PUT", "-T", archive_path, upload_url],
                error_message="Failed to upload archive",
            )
            .execute(timeout=ARCHIVE_UPLOAD_TIMEOUT, raise_on_error=True)
        )
        logger.info("Unmounted archive for sandbox %s", self._sandbox_id)
        return True

    def exists(self) -> bool:
        """Check if archive exists in storage."""
        return self._storage.exists(self._storage_key)

    def delete(self) -> None:
        """Delete archive from storage."""
        try:
            self._storage.delete(self._storage_key)
            logger.info("Deleted archive for sandbox %s", self._sandbox_id)
        except Exception:
            logger.exception("Failed to delete archive for sandbox %s", self._sandbox_id)
