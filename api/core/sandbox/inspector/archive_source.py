from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING
from uuid import uuid4

from core.sandbox.entities.files import SandboxFileDownloadTicket, SandboxFileNode
from core.sandbox.inspector.base import SandboxFileSource
from core.sandbox.inspector.script_utils import (
    build_detect_kind_command,
    build_list_command,
    parse_kind_output,
    parse_list_output,
)
from core.sandbox.storage import SandboxFilePaths
from core.virtual_environment.__base.exec import PipelineExecutionError
from core.virtual_environment.__base.helpers import pipeline
from extensions.ext_storage import storage

if TYPE_CHECKING:
    from core.zip_sandbox import ZipSandbox

logger = logging.getLogger(__name__)


class SandboxFileArchiveSource(SandboxFileSource):
    def _get_archive_download_url(self) -> str:
        """Get a pre-signed download URL for the sandbox archive."""
        from extensions.storage.file_presign_storage import FilePresignStorage

        storage_key = SandboxFilePaths.archive(self._tenant_id, self._app_id, self._sandbox_id)
        if not storage.exists(storage_key):
            raise ValueError("Sandbox archive not found")
        presign_storage = FilePresignStorage(storage.storage_runner)
        return presign_storage.get_download_url(storage_key, self._EXPORT_EXPIRES_IN_SECONDS)

    def _create_zip_sandbox(self) -> ZipSandbox:
        """Create a ZipSandbox instance for archive operations."""
        from core.zip_sandbox import ZipSandbox

        return ZipSandbox(tenant_id=self._tenant_id, user_id="system", app_id=self._app_id)

    def exists(self) -> bool:
        """Check if the sandbox archive exists in storage."""
        storage_key = SandboxFilePaths.archive(self._tenant_id, self._app_id, self._sandbox_id)
        return storage.exists(storage_key)

    def list_files(self, *, path: str, recursive: bool) -> list[SandboxFileNode]:
        archive_url = self._get_archive_download_url()
        with self._create_zip_sandbox() as zs:
            # Download and extract the archive
            archive_path = zs.download_archive(archive_url, path="workspace.tar.gz")
            zs.untar(archive_path=archive_path, dest_dir="workspace")

            # List files using Python script in sandbox
            try:
                list_path = f"workspace/{path}" if path not in (".", "") else "workspace"
                results = (
                    pipeline(zs.vm)
                    .add(
                        build_list_command(list_path, recursive),
                        error_message="Failed to list sandbox files",
                    )
                    .execute(timeout=self._LIST_TIMEOUT_SECONDS, raise_on_error=True)
                )
            except PipelineExecutionError as exc:
                raise RuntimeError(str(exc)) from exc

        raw = parse_list_output(results[0].stdout)

        entries: list[SandboxFileNode] = []
        for item in raw:
            item_path = str(item.get("path"))
            # Strip the "workspace/" prefix from paths
            if item_path.startswith("workspace/"):
                item_path = item_path[len("workspace/") :]
            elif item_path == "workspace":
                continue  # Skip the workspace directory itself

            item_is_dir = bool(item.get("is_dir"))
            extension = None
            if not item_is_dir:
                ext = os.path.splitext(item_path)[1]
                extension = ext or None
            entries.append(
                SandboxFileNode(
                    path=item_path,
                    is_dir=item_is_dir,
                    size=item.get("size"),
                    mtime=item.get("mtime"),
                    extension=extension,
                )
            )
        return sorted(entries, key=lambda e: e.path)

    def download_file(self, *, path: str) -> SandboxFileDownloadTicket:
        """Download a file or directory from the archived sandbox.

        Uses direct upload from sandbox to storage via presigned URL, avoiding
        data transfer through the service layer. This preserves binary integrity
        (no text encoding issues) and reduces bandwidth overhead.
        """
        from services.sandbox.sandbox_file_service import SandboxFileService

        archive_url = self._get_archive_download_url()
        export_name = os.path.basename(path.rstrip("/")) or "workspace"
        export_id = uuid4().hex

        with self._create_zip_sandbox() as zs:
            archive_path = zs.download_archive(archive_url, path="workspace.tar.gz")
            zs.untar(archive_path=archive_path, dest_dir="workspace")

            target_path = f"workspace/{path}" if path not in (".", "") else "workspace"
            try:
                results = (
                    pipeline(zs.vm)
                    .add(
                        build_detect_kind_command(target_path),
                        error_message="Failed to check path in sandbox",
                    )
                    .execute(timeout=self._LIST_TIMEOUT_SECONDS, raise_on_error=True)
                )
            except PipelineExecutionError as exc:
                raise ValueError(str(exc)) from exc

            kind = parse_kind_output(results[0].stdout, not_found_message="File not found in sandbox archive")

            sandbox_storage = SandboxFileService.get_storage()
            is_file = kind == "file"
            filename = (os.path.basename(path) or "file") if is_file else f"{export_name}.tar.gz"
            export_key = SandboxFilePaths.export(self._tenant_id, self._app_id, self._sandbox_id, export_id, filename)
            upload_url = sandbox_storage.get_upload_url(export_key, self._EXPORT_EXPIRES_IN_SECONDS)

            # Build pipeline: for directories, tar first then upload; for files, upload directly
            archive_temp = f"/tmp/{export_id}.tar.gz"
            src_path = target_path if is_file else archive_temp
            tar_src = path if path not in (".", "") else "."

            try:
                (
                    pipeline(zs.vm)
                    .add(
                        ["tar", "-czf", archive_temp, "-C", "workspace", tar_src],
                        error_message="Failed to archive directory",
                        on=not is_file,
                    )
                    .add(
                        ["curl", "-sf", "-X", "PUT", "-T", src_path, upload_url],
                        error_message="Failed to upload file",
                    )
                    .add(["rm", "-f", archive_temp], on=not is_file)
                    .execute(timeout=self._UPLOAD_TIMEOUT_SECONDS, raise_on_error=True)
                )
            except PipelineExecutionError as exc:
                raise RuntimeError(str(exc)) from exc

            download_url = sandbox_storage.get_download_url(export_key, self._EXPORT_EXPIRES_IN_SECONDS)

        return SandboxFileDownloadTicket(
            download_url=download_url,
            expires_in=self._EXPORT_EXPIRES_IN_SECONDS,
            export_id=export_id,
        )
