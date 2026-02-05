from __future__ import annotations

import json
import logging
import os
from uuid import uuid4

from core.sandbox.entities.files import SandboxFileDownloadTicket, SandboxFileNode
from core.sandbox.inspector.base import SandboxFileSource
from core.sandbox.storage import SandboxFilePaths
from core.virtual_environment.__base.exec import CommandExecutionError
from core.virtual_environment.__base.helpers import execute
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
        script = r"""
import json
import os
import sys

path = sys.argv[1]
recursive = sys.argv[2] == "1"

def norm(rel: str) -> str:
    rel = rel.replace("\\\\", "/")
    rel = rel.lstrip("./")
    return rel or "."

def stat_entry(full_path: str, rel_path: str) -> dict:
    st = os.stat(full_path)
    is_dir = os.path.isdir(full_path)
    return {
        "path": norm(rel_path),
        "is_dir": is_dir,
        "size": None if is_dir else int(st.st_size),
        "mtime": int(st.st_mtime),
    }

entries = []
if recursive:
    for root, dirs, files in os.walk(path):
        for d in dirs:
            fp = os.path.join(root, d)
            rp = os.path.relpath(fp, ".")
            entries.append(stat_entry(fp, rp))
        for f in files:
            fp = os.path.join(root, f)
            rp = os.path.relpath(fp, ".")
            entries.append(stat_entry(fp, rp))
else:
    if os.path.isfile(path):
        rel_path = os.path.relpath(path, ".")
        entries.append(stat_entry(path, rel_path))
    else:
        for item in os.scandir(path):
            rel_path = os.path.relpath(item.path, ".")
            entries.append(stat_entry(item.path, rel_path))

print(json.dumps(entries))
"""

        try:
            result = execute(
                self._runtime,
                [
                    "sh",
                    "-c",
                    'if command -v python3 >/dev/null 2>&1; then py=python3; else py=python; fi; "$py" -c "$0" "$@"',
                    script,
                    path,
                    "1" if recursive else "0",
                ],
                timeout=self._LIST_TIMEOUT_SECONDS,
                error_message="Failed to list sandbox files",
            )
        except CommandExecutionError as exc:
            raise RuntimeError(str(exc)) from exc

        try:
            raw = json.loads(result.stdout.decode("utf-8"))
        except Exception as exc:
            raise RuntimeError("Malformed sandbox file list output") from exc

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

        kind = self._detect_path_kind(path)

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
                execute(
                    self._runtime,
                    ["tar", "-czf", archive_path, "-C", ".", path],
                    timeout=self._UPLOAD_TIMEOUT_SECONDS,
                    error_message="Failed to archive directory in sandbox",
                )
                execute(
                    self._runtime,
                    ["curl", "-s", "-f", "-X", "PUT", "-T", archive_path, upload_url],
                    timeout=self._UPLOAD_TIMEOUT_SECONDS,
                    error_message="Failed to upload directory archive from sandbox",
                )
            except CommandExecutionError as exc:
                raise RuntimeError(str(exc)) from exc
            finally:
                try:
                    execute(
                        self._runtime,
                        ["rm", "-f", archive_path],
                        timeout=self._LIST_TIMEOUT_SECONDS,
                        error_message="Failed to cleanup temp archive",
                    )
                except Exception as exc:
                    # Best-effort cleanup; do not fail the download on cleanup issues.
                    logger.debug("Failed to cleanup temp archive %s: %s", archive_path, exc)
        else:
            try:
                content_type = self._guess_image_content_type(path)
                command = [
                    "curl",
                    "-s",
                    "-f",
                    "-X",
                    "PUT",
                ]
                if content_type:
                    # to support image preview in artifacts panel, we need add content-type when upload to S3
                    command.extend(["-H", f"Content-Type: {content_type}"])
                command.extend(["-T", path, upload_url])
                execute(
                    self._runtime,
                    command,
                    timeout=self._UPLOAD_TIMEOUT_SECONDS,
                    error_message="Failed to upload file from sandbox",
                )
            except CommandExecutionError as exc:
                raise RuntimeError(str(exc)) from exc

        download_url = sandbox_storage.get_download_url(export_key, self._EXPORT_EXPIRES_IN_SECONDS)
        return SandboxFileDownloadTicket(
            download_url=download_url,
            expires_in=self._EXPORT_EXPIRES_IN_SECONDS,
            export_id=export_id,
        )

    def _detect_path_kind(self, path: str) -> str:
        script = r"""
import os
import sys

p = sys.argv[1]
if os.path.isdir(p):
    print("dir")
    raise SystemExit(0)
if os.path.isfile(p):
    print("file")
    raise SystemExit(0)
print("none")
raise SystemExit(2)
"""

        try:
            result = execute(
                self._runtime,
                [
                    "sh",
                    "-c",
                    'if command -v python3 >/dev/null 2>&1; then py=python3; else py=python; fi; "$py" -c "$0" "$@"',
                    script,
                    path,
                ],
                timeout=self._LIST_TIMEOUT_SECONDS,
                error_message="Failed to check path in sandbox",
            )
        except CommandExecutionError as exc:
            raise ValueError(str(exc)) from exc

        kind = result.stdout.decode("utf-8", errors="replace").strip()
        if kind not in ("dir", "file"):
            raise ValueError("File not found in sandbox")
        return kind
