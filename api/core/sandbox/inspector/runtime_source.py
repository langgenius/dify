from __future__ import annotations

import logging
import os
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
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

logger = logging.getLogger(__name__)


class SandboxFileRuntimeSource(SandboxFileSource):
    def __init__(self, *, tenant_id: str, app_id: str, sandbox_id: str, runtime: VirtualEnvironment):
        super().__init__(tenant_id=tenant_id, app_id=app_id, sandbox_id=sandbox_id)
        self._runtime = runtime

    def exists(self) -> bool:
        """Check if the sandbox runtime exists and is available."""
        return self._runtime is not None

    def list_files(self, *, path: str, recursive: bool) -> list[SandboxFileNode]:
        try:
            results = (
                pipeline(self._runtime)
                .add(
                    build_list_command(path, recursive),
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
        return entries

    def download_file(self, *, path: str) -> SandboxFileDownloadTicket:
        from services.sandbox.sandbox_file_service import SandboxFileService

        try:
            results = (
                pipeline(self._runtime)
                .add(
                    build_detect_kind_command(path),
                    error_message="Failed to check path in sandbox",
                )
                .execute(timeout=self._LIST_TIMEOUT_SECONDS, raise_on_error=True)
            )
        except PipelineExecutionError as exc:
            raise ValueError(str(exc)) from exc

        kind = parse_kind_output(results[0].stdout, not_found_message="File not found in sandbox")

        export_name = os.path.basename(path.rstrip("/")) or "workspace"
        filename = f"{export_name}.tar.gz" if kind == "dir" else (os.path.basename(path) or "file")
        export_id = uuid4().hex
        export_key = SandboxFilePaths.export(
            self._tenant_id,
            self._app_id,
            self._sandbox_id,
            export_id,
            filename,
        )

        sandbox_storage = SandboxFileService.get_storage()
        upload_url = sandbox_storage.get_upload_url(export_key, self._EXPORT_EXPIRES_IN_SECONDS)

        if kind == "dir":
            archive_path = f"/tmp/{export_id}.tar.gz"
            try:
                (
                    pipeline(self._runtime)
                    .add(
                        ["tar", "-czf", archive_path, "-C", ".", path],
                        error_message="Failed to archive directory in sandbox",
                    )
                    .add(
                        ["curl", "-s", "-f", "-X", "PUT", "-T", archive_path, upload_url],
                        error_message="Failed to upload directory archive from sandbox",
                    )
                    .execute(timeout=self._UPLOAD_TIMEOUT_SECONDS, raise_on_error=True)
                )
            except PipelineExecutionError as exc:
                raise RuntimeError(str(exc)) from exc
            finally:
                try:
                    pipeline(self._runtime).add(["rm", "-f", archive_path]).execute(
                        timeout=self._LIST_TIMEOUT_SECONDS
                    )
                except Exception as exc:
                    # Best-effort cleanup; do not fail the download on cleanup issues.
                    logger.debug("Failed to cleanup temp archive %s: %s", archive_path, exc)
        else:
            try:
                (
                    pipeline(self._runtime)
                    .add(
                        ["curl", "-s", "-f", "-X", "PUT", "-T", path, upload_url],
                        error_message="Failed to upload file from sandbox",
                    )
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
