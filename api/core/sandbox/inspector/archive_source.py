from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING
from uuid import uuid4

from core.sandbox.entities.files import SandboxFileDownloadTicket, SandboxFileNode
from core.sandbox.inspector.base import SandboxFileSource
from core.sandbox.storage import SandboxFilePaths
from core.virtual_environment.__base.exec import CommandExecutionError
from core.virtual_environment.__base.helpers import execute
from extensions.ext_storage import storage

if TYPE_CHECKING:
    from core.zip_sandbox import ZipSandbox


class SandboxFileArchiveSource(SandboxFileSource):
    _PYTHON_EXEC_CMD = 'if command -v python3 >/dev/null 2>&1; then py=python3; else py=python; fi; "$py" -c "$0" "$@"'
    _LIST_SCRIPT = r"""
import json
import os
import sys

path = sys.argv[1]
recursive = sys.argv[2] == "1"

def norm(rel: str) -> str:
    rel = rel.replace("\\", "/")
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

    def _get_archive_download_url(self) -> str:
        """Get a pre-signed download URL for the sandbox archive."""
        from extensions.storage.file_presign_storage import FilePresignStorage

        storage_key = f"sandbox_archives/{self._tenant_id}/{self._sandbox_id}.tar.gz"
        if not storage.exists(storage_key):
            raise ValueError("Sandbox archive not found")
        presign_storage = FilePresignStorage(storage.storage_runner)
        return presign_storage.get_download_url(storage_key, self._EXPORT_EXPIRES_IN_SECONDS)

    def _create_zip_sandbox(self) -> ZipSandbox:
        """Create a ZipSandbox instance for archive operations."""
        from core.zip_sandbox import ZipSandbox

        return ZipSandbox(tenant_id=self._tenant_id, user_id="system", app_id="sandbox-archive-browser")

    def list_files(self, *, path: str, recursive: bool) -> list[SandboxFileNode]:
        archive_url = self._get_archive_download_url()

        with self._create_zip_sandbox() as zs:
            # Download and extract the archive
            archive_path = zs.download_archive(archive_url, path="workspace.tar.gz")
            zs.untar(archive_path=archive_path, dest_dir="workspace")

            # List files using Python script in sandbox
            try:
                result = execute(
                    zs.vm,
                    [
                        "sh",
                        "-c",
                        self._PYTHON_EXEC_CMD,
                        self._LIST_SCRIPT,
                        f"workspace/{path}" if path not in (".", "") else "workspace",
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
        archive_url = self._get_archive_download_url()
        export_name = os.path.basename(path.rstrip("/")) or "workspace"
        export_id = uuid4().hex

        with self._create_zip_sandbox() as zs:
            # Download and extract the archive
            archive_path = zs.download_archive(archive_url, path="workspace.tar.gz")
            zs.untar(archive_path=archive_path, dest_dir="workspace")

            # Determine the target path inside extracted workspace
            target_path = f"workspace/{path}" if path not in (".", "") else "workspace"

            # Detect if target is file or directory
            detect_script = r"""
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
                    zs.vm,
                    [
                        "sh",
                        "-c",
                        self._PYTHON_EXEC_CMD,
                        detect_script,
                        target_path,
                    ],
                    timeout=self._LIST_TIMEOUT_SECONDS,
                    error_message="Failed to check path in sandbox",
                )
            except CommandExecutionError as exc:
                raise ValueError(str(exc)) from exc

            kind = result.stdout.decode("utf-8", errors="replace").strip()
            if kind not in ("dir", "file"):
                raise ValueError("File not found in sandbox archive")

            from services.sandbox.sandbox_file_service import SandboxFileService

            sandbox_storage = SandboxFileService.get_storage()

            if kind == "file":
                # Download file content from sandbox
                file_data = zs.read_file(target_path)
                export_key = SandboxFilePaths.export(
                    self._tenant_id,
                    self._sandbox_id,
                    export_id,
                    os.path.basename(path) or "file",
                )
                sandbox_storage.save(export_key, file_data)
            else:
                # Create tar.gz archive of the directory
                tar_file = zs.tar(target_path, include_base=True, compress=True)
                tar_data = zs.read_file(tar_file.path)
                export_key = SandboxFilePaths.export(
                    self._tenant_id,
                    self._sandbox_id,
                    export_id,
                    f"{export_name}.tar.gz",
                )
                sandbox_storage.save(export_key, tar_data)

            download_url = sandbox_storage.get_download_url(export_key, self._EXPORT_EXPIRES_IN_SECONDS)
        return SandboxFileDownloadTicket(
            download_url=download_url,
            expires_in=self._EXPORT_EXPIRES_IN_SECONDS,
            export_id=export_id,
        )
