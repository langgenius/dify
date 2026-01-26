from __future__ import annotations

import abc
import json
import logging
import os
import tempfile
from pathlib import Path, PurePosixPath
from uuid import UUID, uuid4

from core.sandbox.entities.files import SandboxFileDownloadTicket, SandboxFileNode
from core.sandbox.manager import SandboxManager
from core.sandbox.security.archive_signer import SandboxArchivePath
from core.sandbox.security.sandbox_file_signer import SandboxFileDownloadPath
from core.sandbox.storage import sandbox_file_storage
from core.virtual_environment.__base.exec import CommandExecutionError
from core.virtual_environment.__base.helpers import execute
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from extensions.ext_storage import storage

logger = logging.getLogger(__name__)


class SandboxFileSource(abc.ABC):
    _LIST_TIMEOUT_SECONDS = 30
    _UPLOAD_TIMEOUT_SECONDS = 60
    _EXPORT_EXPIRES_IN_SECONDS = 60 * 5

    def __init__(self, *, tenant_id: str, sandbox_id: str):
        self._tenant_id = tenant_id
        self._sandbox_id = sandbox_id

    @abc.abstractmethod
    def list_files(self, *, path: str, recursive: bool) -> list[SandboxFileNode]:
        raise NotImplementedError

    @abc.abstractmethod
    def download_file(self, *, path: str) -> SandboxFileDownloadTicket:
        raise NotImplementedError


class SandboxFileRuntimeSource(SandboxFileSource):
    def __init__(self, *, tenant_id: str, sandbox_id: str, runtime: VirtualEnvironment):
        super().__init__(tenant_id=tenant_id, sandbox_id=sandbox_id)
        self._runtime = runtime

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
            entries.append(
                SandboxFileNode(
                    path=str(item.get("path")),
                    is_dir=bool(item.get("is_dir")),
                    size=item.get("size"),
                    mtime=item.get("mtime"),
                )
            )
        return entries

    def download_file(self, *, path: str) -> SandboxFileDownloadTicket:
        kind = self._detect_path_kind(path)

        export_name = os.path.basename(path.rstrip("/")) or "workspace"
        filename = f"{export_name}.tar.gz" if kind == "dir" else (os.path.basename(path) or "file")
        export_id = uuid4().hex
        export_path = SandboxFileDownloadPath(
            tenant_id=UUID(self._tenant_id),
            sandbox_id=UUID(self._sandbox_id),
            export_id=export_id,
            filename=filename,
        )

        upload_url = sandbox_file_storage.get_upload_url(export_path, expires_in=self._EXPORT_EXPIRES_IN_SECONDS)

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
                execute(
                    self._runtime,
                    ["curl", "-s", "-f", "-X", "PUT", "-T", path, upload_url],
                    timeout=self._UPLOAD_TIMEOUT_SECONDS,
                    error_message="Failed to upload file from sandbox",
                )
            except CommandExecutionError as exc:
                raise RuntimeError(str(exc)) from exc

        download_url = sandbox_file_storage.get_download_url(export_path, expires_in=self._EXPORT_EXPIRES_IN_SECONDS)
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


class SandboxFileArchiveSource(SandboxFileSource):
    def list_files(self, *, path: str, recursive: bool) -> list[SandboxFileNode]:
        import tarfile

        archive_path = SandboxArchivePath(tenant_id=UUID(self._tenant_id), sandbox_id=UUID(self._sandbox_id))
        storage_key = archive_path.get_storage_key()
        if not storage.exists(storage_key):
            raise ValueError("Sandbox archive not found")

        with tempfile.TemporaryDirectory(prefix="dify-sandbox-archive-") as tmpdir:
            local_archive = os.path.join(tmpdir, "workspace.tar.gz")
            storage.download(storage_key, local_archive)

            entries_by_path: dict[str, SandboxFileNode] = {}

            def add_dir(dir_path: str) -> None:
                if dir_path in ("", "."):
                    return
                if dir_path not in entries_by_path:
                    entries_by_path[dir_path] = SandboxFileNode(path=dir_path, is_dir=True, size=None, mtime=None)

            def clean(member_name: str) -> str:
                name = member_name.lstrip("./")
                return name.rstrip("/")

            target_prefix = "" if path in (".", "") else f"{path}/"

            with tarfile.open(local_archive, mode="r:gz") as tf:
                for m in tf.getmembers():
                    mp = clean(m.name)
                    if mp in ("", "."):
                        continue

                    if not recursive:
                        if path in (".", ""):
                            if "/" in mp:
                                add_dir(mp.split("/", 1)[0])
                                continue
                        else:
                            if not mp.startswith(target_prefix):
                                continue
                            rest = mp[len(target_prefix) :]
                            if rest == "":
                                continue
                            if "/" in rest:
                                add_dir(f"{path}/{rest.split('/', 1)[0]}")
                                continue
                    else:
                        if path not in (".", "") and not (mp == path or mp.startswith(target_prefix)):
                            continue

                    parent = os.path.dirname(mp)
                    while parent not in ("", "."):
                        if path not in (".", "") and parent == path:
                            break
                        add_dir(parent)
                        parent = os.path.dirname(parent)

                    is_dir = m.isdir()
                    entries_by_path[mp] = SandboxFileNode(
                        path=mp,
                        is_dir=is_dir,
                        size=None if is_dir else int(m.size),
                        mtime=int(m.mtime) if m.mtime else None,
                    )

            return sorted(entries_by_path.values(), key=lambda e: e.path)

    def download_file(self, *, path: str) -> SandboxFileDownloadTicket:
        import tarfile

        archive_path = SandboxArchivePath(tenant_id=UUID(self._tenant_id), sandbox_id=UUID(self._sandbox_id))
        storage_key = archive_path.get_storage_key()
        if not storage.exists(storage_key):
            raise ValueError("Sandbox archive not found")

        export_name = os.path.basename(path.rstrip("/")) or "workspace"
        export_id = uuid4().hex

        # Decide file vs directory inside archive.
        is_dir_request = path in (".", "")

        with tempfile.TemporaryDirectory(prefix="dify-sandbox-archive-") as tmpdir:
            local_archive = os.path.join(tmpdir, "workspace.tar.gz")
            storage.download(storage_key, local_archive)

            with tarfile.open(local_archive, mode="r:gz") as tf:
                member_name = path.lstrip("./").rstrip("/")
                if not is_dir_request:
                    # If it is an explicit file in archive, treat as file download.
                    member = None
                    try:
                        member = tf.getmember(member_name)
                    except KeyError:
                        try:
                            member = tf.getmember(f"./{member_name}")
                        except KeyError:
                            member = None

                    if member is not None and not member.isdir():
                        export_path = SandboxFileDownloadPath(
                            tenant_id=UUID(self._tenant_id),
                            sandbox_id=UUID(self._sandbox_id),
                            export_id=export_id,
                            filename=os.path.basename(member_name) or "file",
                        )
                        extracted = tf.extractfile(member)
                        if extracted is None:
                            raise ValueError("File not found in sandbox archive")
                        sandbox_file_storage.save(export_path, extracted.read())

                        download_url = sandbox_file_storage.get_download_url(
                            export_path, expires_in=self._EXPORT_EXPIRES_IN_SECONDS
                        )
                        return SandboxFileDownloadTicket(
                            download_url=download_url,
                            expires_in=self._EXPORT_EXPIRES_IN_SECONDS,
                            export_id=export_id,
                        )

                    # Otherwise treat as directory (implied dir is common in tar).
                    is_dir_request = True

                if is_dir_request:
                    export_path = SandboxFileDownloadPath(
                        tenant_id=UUID(self._tenant_id),
                        sandbox_id=UUID(self._sandbox_id),
                        export_id=export_id,
                        filename=f"{export_name}.tar.gz",
                    )
                    export_local = os.path.join(tmpdir, "export.tar.gz")

                    prefix = "" if member_name in (".", "") else f"{member_name}/"
                    found_any = False
                    for m in tf.getmembers():
                        src_name = m.name.lstrip("./").rstrip("/")
                        if member_name not in (".", ""):
                            if src_name != member_name and not src_name.startswith(prefix):
                                continue
                        found_any = True
                        break

                    if not found_any:
                        raise ValueError("File not found in sandbox archive")

                    with tarfile.open(export_local, mode="w:gz") as out:
                        if member_name not in (".", ""):
                            dir_info = tarfile.TarInfo(name=member_name)
                            dir_info.type = tarfile.DIRTYPE
                            dir_info.size = 0
                            out.addfile(dir_info)

                        for m in tf.getmembers():
                            src_name = m.name.lstrip("./")
                            if member_name not in (".", ""):
                                if src_name != member_name and not src_name.startswith(prefix):
                                    continue
                            ti = tarfile.TarInfo(name=src_name.rstrip("/"))
                            ti.mode = m.mode
                            ti.mtime = m.mtime
                            ti.uid = m.uid
                            ti.gid = m.gid
                            ti.uname = m.uname
                            ti.gname = m.gname
                            if m.isdir():
                                ti.type = tarfile.DIRTYPE
                                ti.size = 0
                                out.addfile(ti)
                                continue
                            extracted = tf.extractfile(m)
                            if extracted is None:
                                continue
                            ti.size = int(m.size)
                            out.addfile(ti, fileobj=extracted)

                    sandbox_file_storage.save(export_path, Path(export_local).read_bytes())

                    download_url = sandbox_file_storage.get_download_url(
                        export_path, expires_in=self._EXPORT_EXPIRES_IN_SECONDS
                    )
                    return SandboxFileDownloadTicket(
                        download_url=download_url,
                        expires_in=self._EXPORT_EXPIRES_IN_SECONDS,
                        export_id=export_id,
                    )

        raise ValueError("File not found in sandbox archive")


class SandboxFileBrowser:
    def __init__(self, *, tenant_id: str, sandbox_id: str):
        self._tenant_id = tenant_id
        self._sandbox_id = sandbox_id

    @staticmethod
    def _normalize_workspace_path(path: str | None) -> str:
        raw = (path or ".").strip()
        if raw == "":
            raw = "."

        p = PurePosixPath(raw)
        if p.is_absolute():
            raise ValueError("path must be relative")
        if any(part == ".." for part in p.parts):
            raise ValueError("path must not contain '..'")

        normalized = str(p)
        return "." if normalized in (".", "") else normalized

    def _backend(self) -> SandboxFileSource:
        runtime = SandboxManager.get(self._sandbox_id)
        if runtime is not None:
            return SandboxFileRuntimeSource(tenant_id=self._tenant_id, sandbox_id=self._sandbox_id, runtime=runtime)
        return SandboxFileArchiveSource(tenant_id=self._tenant_id, sandbox_id=self._sandbox_id)

    def list_files(self, *, path: str | None = None, recursive: bool = False) -> list[SandboxFileNode]:
        workspace_path = self._normalize_workspace_path(path)
        return self._backend().list_files(path=workspace_path, recursive=recursive)

    def download_file(self, *, path: str) -> SandboxFileDownloadTicket:
        workspace_path = self._normalize_workspace_path(path)
        return self._backend().download_file(path=workspace_path)
