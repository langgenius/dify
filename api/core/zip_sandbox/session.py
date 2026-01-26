from __future__ import annotations

import hashlib
import posixpath
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
from types import TracebackType
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from core.sandbox.builder import SandboxBuilder
from core.sandbox.entities.sandbox_type import SandboxType
from core.sandbox.manager import SandboxManager
from core.sandbox.sandbox import Sandbox
from core.sandbox.storage.noop_storage import NoopSandboxStorage
from core.virtual_environment.__base.exec import CommandExecutionError, PipelineExecutionError
from core.virtual_environment.__base.helpers import execute, pipeline
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from services.sandbox.sandbox_provider_service import SandboxProviderService


@dataclass(frozen=True)
class SandboxArchiveFile:
    file_path: str
    size_bytes: int
    sha256: str


class ZipSandbox:
    """A sandbox specifically for archive (tar) operations.

    Usage:
        with ZipSandbox(tenant_id=..., user_id=...) as zs:
            zs.write_file("a.txt", b"hello")
            archive = zs.tar()
            zs.upload(path=archive.file_path, target_url=url)
        # VM automatically released on exit
    """

    _DEFAULT_TIMEOUT_SECONDS = 60 * 5

    def __init__(
        self,
        *,
        tenant_id: str | None = None,
        user_id: str | None = None,
        app_id: str = "zip-sandbox",
        sandbox_provider_type: str | None = None,
        sandbox_provider_options: dict[str, Any] | None = None,
        # For testing: allow injecting a VM directly
        _vm: VirtualEnvironment | None = None,
    ) -> None:
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._app_id = app_id
        self._sandbox_provider_type = sandbox_provider_type
        self._sandbox_provider_options = sandbox_provider_options
        self._injected_vm = _vm

        self._sandbox: Sandbox | None = None
        self._sandbox_id: str | None = None
        self._vm: VirtualEnvironment | None = None

    def __enter__(self) -> ZipSandbox:
        self._start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self._stop()

    def _start(self) -> None:
        if self._vm is not None:
            raise RuntimeError("ZipSandbox already started")

        # If VM is injected (for testing), use it directly
        if self._injected_vm is not None:
            self._vm = self._injected_vm
            self._sandbox_id = uuid4().hex
            return

        if not self._tenant_id:
            raise ValueError("tenant_id is required")
        if not self._user_id:
            raise ValueError("user_id is required")

        if self._sandbox_provider_type is None or self._sandbox_provider_options is None:
            provider = SandboxProviderService.get_sandbox_provider(self._tenant_id)
            provider_type = provider.provider_type
            provider_options = dict(provider.config)
        else:
            provider_type = self._sandbox_provider_type
            provider_options = dict(self._sandbox_provider_options)

        self._sandbox_id = uuid4().hex

        storage = NoopSandboxStorage()
        self._sandbox = (
            SandboxBuilder(self._tenant_id, SandboxType(provider_type))
            .options(provider_options)
            .user(self._user_id)
            .app(self._app_id)
            .storage(storage, assets_id="zip-sandbox")
            .build()
        )
        self._sandbox.wait_ready(timeout=60)
        self._vm = self._sandbox.vm

        SandboxManager.register(self._sandbox_id, self._vm)

    def _stop(self) -> None:
        if self._vm is None:
            return

        if self._sandbox_id:
            SandboxManager.unregister(self._sandbox_id)

        if self._sandbox is not None:
            self._sandbox.release()

        self._vm = None
        self._sandbox = None
        self._sandbox_id = None

    @property
    def vm(self) -> VirtualEnvironment:
        if self._vm is None:
            raise RuntimeError("ZipSandbox not started. Use 'with ZipSandbox(...) as zs:'")
        return self._vm

    # ========== Path utilities ==========

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

    @staticmethod
    def _dest_path_for_url(dest_dir: str, url: str) -> str:
        parsed = urlparse(url)
        path = parsed.path or ""
        name = posixpath.basename(path)
        if not name:
            name = "download.bin"
        return posixpath.join(dest_dir, name)

    # ========== File operations ==========

    def write_file(self, path: str, data: bytes) -> None:
        path = self._normalize_workspace_path(path)
        if path in ("", "."):
            raise ValueError("path must point to a file")

        try:
            self.vm.upload_file(path, BytesIO(data))
        except Exception as exc:
            raise RuntimeError(f"Failed to write file to sandbox: {exc}") from exc

    def read_file(self, path: str, *, max_bytes: int = 10 * 1024 * 1024) -> bytes:
        path = self._normalize_workspace_path(path)
        if max_bytes <= 0:
            raise ValueError("max_bytes must be positive")

        try:
            data = self.vm.download_file(path).getvalue()
        except Exception as exc:
            raise RuntimeError(f"Failed to read file from sandbox: {exc}") from exc

        if len(data) > max_bytes:
            raise ValueError(f"File too large: {len(data)} > {max_bytes}")
        return data

    # ========== Download operations ==========

    def download(self, urls: list[str], *, dest_dir: str = ".") -> list[str]:
        if not urls:
            return []

        dest_dir = self._normalize_workspace_path(dest_dir)

        paths = [self._dest_path_for_url(dest_dir, u) for u in urls]
        p = pipeline(self.vm)
        p.add(["mkdir", "-p", dest_dir], error_message="Failed to create download directory")
        for url, out_path in zip(urls, paths, strict=True):
            p.add(["curl", "-fsSL", url, "-o", out_path], error_message="Failed to download file")

        try:
            p.execute(timeout=self._DEFAULT_TIMEOUT_SECONDS, raise_on_error=True)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

        return paths

    def download_archive(self, archive_url: str, *, path: str = "input.tar.gz") -> str:
        path = self._normalize_workspace_path(path)

        dir_path = posixpath.dirname(path)
        p = pipeline(self.vm)
        if dir_path not in ("", "."):
            p.add(["mkdir", "-p", dir_path], error_message=f"Failed to create archive download directory {dir_path}")
        p.add(["curl", "-fsSL", archive_url, "-o", path], error_message=f"Failed to download archive to {path}")
        try:
            p.execute(timeout=self._DEFAULT_TIMEOUT_SECONDS, raise_on_error=True)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

        return path

    # ========== Upload operations ==========

    def upload(self, *, path: str, target_url: str) -> None:
        path = self._normalize_workspace_path(path)
        if path in ("", "."):
            raise ValueError("path must point to a file")

        try:
            execute(
                self.vm,
                ["curl", "-fsSL", "-X", "PUT", "-T", path, target_url],
                timeout=self._DEFAULT_TIMEOUT_SECONDS,
                error_message="Failed to upload file from sandbox",
            )
        except CommandExecutionError as exc:
            raise RuntimeError(str(exc)) from exc

    # ========== Archive operations ==========

    def tar(self, src: str = ".", *, out_path: str | None = None) -> SandboxArchiveFile:
        src = self._normalize_workspace_path(src)
        if out_path is None:
            out_path = f"{uuid4().hex}.tar"
        out_path = self._normalize_workspace_path(out_path)
        lower_out = out_path.lower()
        if not (lower_out.endswith(".tar") or lower_out.endswith(".tar.gz") or lower_out.endswith(".tgz")):
            raise ValueError("out_path must end with .tar/.tar.gz/.tgz")

        out_dir = posixpath.dirname(out_path)
        is_gz = lower_out.endswith(".tar.gz") or lower_out.endswith(".tgz")
        tar_flag = "-czf" if is_gz else "-cf"
        is_cwd = src in (".", "")

        # Avoid "archive cannot contain itself" when archiving the current directory.
        # Create the archive outside the workspace tree and move it into place.
        tmp_archive = f"/tmp/{uuid4().hex}{'.tar.gz' if is_gz else '.tar'}"

        try:
            (
                pipeline(self.vm)
                .add(
                    ["mkdir", "-p", out_dir],
                    error_message="Failed to create archive output directory",
                    on=out_dir not in ("", "."),
                )
                .add(
                    ["tar", tar_flag, tmp_archive, "-C", ".", "."],
                    error_message="Failed to create tar archive",
                    on=is_cwd,
                )
                .add(["tar", tar_flag, tmp_archive, src], error_message="Failed to create tar archive", on=not is_cwd)
                .add(["mv", "-f", tmp_archive, out_path], error_message="Failed to move tar archive into place")
                .execute(timeout=self._DEFAULT_TIMEOUT_SECONDS, raise_on_error=True)
            )
        except PipelineExecutionError as exc:
            raise RuntimeError(str(exc)) from exc

        # Compute size + sha256 on host side (avoid requiring sha256sum in sandbox).
        try:
            data = self.vm.download_file(out_path).getvalue()
        except Exception as exc:
            raise RuntimeError(f"Failed to read tar result from sandbox: {exc}") from exc

        return SandboxArchiveFile(file_path=out_path, size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest())

    def untar(self, *, archive_path: str, dest_dir: str = "unpacked") -> str:
        archive_path = self._normalize_workspace_path(archive_path)
        dest_dir = self._normalize_workspace_path(dest_dir)

        lower = archive_path.lower()
        is_gz = lower.endswith(".tar.gz") or lower.endswith(".tgz")
        extract_flag = "-xzf" if is_gz else "-xf"

        try:
            (
                pipeline(self.vm)
                .add(["mkdir", "-p", dest_dir], error_message="Failed to create untar destination directory")
                .add(["tar", extract_flag, archive_path, "-C", dest_dir], error_message="Failed to extract tar archive")
                .execute(timeout=self._DEFAULT_TIMEOUT_SECONDS, raise_on_error=True)
            )
        except PipelineExecutionError as exc:
            raise RuntimeError(str(exc)) from exc

        return dest_dir
