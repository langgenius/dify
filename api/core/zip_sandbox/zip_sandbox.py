from __future__ import annotations

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

from .cli_strategy import CliZipStrategy
from .node_strategy import NodeZipStrategy
from .python_strategy import PythonZipStrategy
from .strategy import ZipStrategy


@dataclass(frozen=True)
class SandboxDownloadItem:
    """Item for downloading: URL -> sandbox path."""

    url: str
    path: str


@dataclass(frozen=True)
class SandboxUploadItem:
    """Item for uploading: sandbox path -> URL."""

    path: str
    url: str


@dataclass(frozen=True)
class SandboxFile:
    """A handle to a file in the sandbox."""

    path: str


class ZipSandbox:
    """A sandbox for archive (zip) operations.

    Usage:
        with ZipSandbox(tenant_id=..., user_id=...) as zs:
            zs.download_items(items)
            archive = zs.zip()
            zs.upload(archive, upload_url)
        # VM automatically released on exit
    """

    _DEFAULT_TIMEOUT_SECONDS = 60 * 5
    _STRATEGIES: list[ZipStrategy] = [CliZipStrategy(), PythonZipStrategy(), NodeZipStrategy()]

    def __init__(
        self,
        *,
        tenant_id: str | None = None,
        user_id: str | None = None,
        app_id: str = "zip-sandbox",
        sandbox_provider_type: str | None = None,
        sandbox_provider_options: dict[str, Any] | None = None,
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
        self._strategy: ZipStrategy | None = None

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

        SandboxManager.register(self._sandbox_id, self._sandbox)

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
        self._strategy = None

    @property
    def vm(self) -> VirtualEnvironment:
        if self._vm is None:
            raise RuntimeError("ZipSandbox not started. Use 'with ZipSandbox(...) as zs:'")
        return self._vm

    def _get_strategy(self) -> ZipStrategy:
        if self._strategy is not None:
            return self._strategy

        for strategy in self._STRATEGIES:
            if strategy.is_available(self.vm):
                self._strategy = strategy
                return strategy

        raise RuntimeError("No available zip backend (zip/python/node+adm-zip)")

    # ========== Path utilities ==========

    @staticmethod
    def _normalize_path(path: str | None) -> str:
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
        path = self._normalize_path(path)
        if path in ("", "."):
            raise ValueError("path must point to a file")

        try:
            self.vm.upload_file(path, BytesIO(data))
        except Exception as exc:
            raise RuntimeError(f"Failed to write file to sandbox: {exc}") from exc

    def read_file(self, path: str, *, max_bytes: int = 10 * 1024 * 1024) -> bytes:
        path = self._normalize_path(path)
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

    def download_items(self, items: list[SandboxDownloadItem], *, dest_dir: str = ".") -> list[str]:
        if not items:
            return []

        dest_dir = self._normalize_path(dest_dir)
        p = pipeline(self.vm)
        p.add(["mkdir", "-p", dest_dir], error_message="Failed to create download directory")

        out_paths: list[str] = []
        for item in items:
            rel = self._normalize_path(item.path)
            if rel in ("", "."):
                raise ValueError("Download item path must point to a file")
            out_path = posixpath.join(dest_dir, rel)
            out_paths.append(out_path)
            out_dir = posixpath.dirname(out_path)
            if out_dir not in ("", "."):
                p.add(["mkdir", "-p", out_dir], error_message="Failed to create download directory")
            p.add(["curl", "-fsSL", item.url, "-o", out_path], error_message="Failed to download file")

        try:
            p.execute(timeout=self._DEFAULT_TIMEOUT_SECONDS, raise_on_error=True)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

        return out_paths

    def download_archive(self, archive_url: str, *, path: str = "input.tar.gz") -> str:
        path = self._normalize_path(path)

        dir_path = posixpath.dirname(path)
        p = pipeline(self.vm)
        if dir_path not in ("", "."):
            p.add(["mkdir", "-p", dir_path], error_message=f"Failed to create directory {dir_path}")
        p.add(["curl", "-fsSL", archive_url, "-o", path], error_message=f"Failed to download archive to {path}")

        try:
            p.execute(timeout=self._DEFAULT_TIMEOUT_SECONDS, raise_on_error=True)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

        return path

    # ========== Upload operations ==========

    def upload(self, file: SandboxFile, target_url: str) -> None:
        """Upload a sandbox file to the given URL."""
        try:
            execute(
                self.vm,
                ["curl", "-fsSL", "-X", "PUT", "-T", file.path, target_url],
                timeout=self._DEFAULT_TIMEOUT_SECONDS,
                error_message="Failed to upload file from sandbox",
            )
        except CommandExecutionError as exc:
            raise RuntimeError(str(exc)) from exc

    def upload_items(self, items: list[SandboxUploadItem], *, src_dir: str = ".") -> None:
        """Upload multiple files from sandbox to target URLs.

        Args:
            items: List of SandboxUploadItem(path, url)
            src_dir: Base directory containing the files
        """
        if not items:
            return

        src_dir = self._normalize_path(src_dir)
        p = pipeline(self.vm)

        for item in items:
            rel = self._normalize_path(item.path)
            src_path = posixpath.join(src_dir, rel) if src_dir not in ("", ".") else rel
            p.add(
                ["curl", "-fsSL", "-X", "PUT", "-T", src_path, item.url],
                error_message=f"Failed to upload {item.path}",
            )

        try:
            p.execute(timeout=self._DEFAULT_TIMEOUT_SECONDS, raise_on_error=True)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

    # ========== Archive operations ==========

    def zip(self, src: str = ".", *, include_base: bool = True) -> SandboxFile:
        """Create a zip archive and return a handle to it."""
        src = self._normalize_path(src)
        out_path = f"/tmp/{uuid4().hex}.zip"

        cwd = None
        src_for_strategy = src
        if src not in (".", "") and not include_base:
            cwd = src
            src_for_strategy = "."

        try:
            self._get_strategy().zip(
                self.vm,
                src=src_for_strategy,
                out_path=out_path,
                cwd=cwd,
                timeout=self._DEFAULT_TIMEOUT_SECONDS,
            )
        except (PipelineExecutionError, CommandExecutionError) as exc:
            raise RuntimeError(str(exc)) from exc

        return SandboxFile(path=out_path)

    def unzip(self, *, archive_path: str, dest_dir: str = "unpacked") -> str:
        """Extract a zip archive to the destination directory."""
        archive_path = self._normalize_path(archive_path)
        dest_dir = self._normalize_path(dest_dir)

        if not archive_path.lower().endswith(".zip"):
            raise ValueError("archive_path must end with .zip")

        try:
            pipeline(self.vm).add(
                ["mkdir", "-p", dest_dir], error_message="Failed to create destination directory"
            ).execute(timeout=self._DEFAULT_TIMEOUT_SECONDS, raise_on_error=True)

            self._get_strategy().unzip(
                self.vm,
                archive_path=archive_path,
                dest_dir=dest_dir,
                timeout=self._DEFAULT_TIMEOUT_SECONDS,
            )
        except (PipelineExecutionError, CommandExecutionError) as exc:
            raise RuntimeError(str(exc)) from exc

        return dest_dir

    def untar(self, *, archive_path: str, dest_dir: str = "unpacked") -> str:
        """Extract a tar archive to the destination directory."""
        archive_path = self._normalize_path(archive_path)
        dest_dir = self._normalize_path(dest_dir)

        lower = archive_path.lower()
        is_gz = lower.endswith(".tar.gz") or lower.endswith(".tgz")
        extract_flag = "-xzf" if is_gz else "-xf"

        try:
            (
                pipeline(self.vm)
                .add(["mkdir", "-p", dest_dir], error_message="Failed to create destination directory")
                .add(
                    ["sh", "-c", f'tar {extract_flag} "$1" -C "$2" 2>/dev/null; exit $?', "sh", archive_path, dest_dir],
                    error_message="Failed to extract tar archive",
                )
                .execute(timeout=self._DEFAULT_TIMEOUT_SECONDS, raise_on_error=True)
            )
        except PipelineExecutionError as exc:
            raise RuntimeError(str(exc)) from exc

        return dest_dir

    def tar(self, src: str = ".", *, include_base: bool = True, compress: bool = True) -> SandboxFile:
        """Create a tar archive and return a handle to it.

        Args:
            src: Source path to archive (file or directory)
            include_base: If True, include the base directory name in the archive
            compress: If True, create a gzipped tar archive (.tar.gz)

        Returns:
            SandboxFile handle to the created archive
        """
        src = self._normalize_path(src)
        extension = ".tar.gz" if compress else ".tar"
        out_path = f"/tmp/{uuid4().hex}{extension}"

        create_flag = "-czf" if compress else "-cf"

        try:
            if src in (".", ""):
                # Archive current directory contents
                execute(
                    self.vm,
                    ["tar", create_flag, out_path, "-C", ".", "."],
                    timeout=self._DEFAULT_TIMEOUT_SECONDS,
                    error_message="Failed to create tar archive",
                )
            elif include_base:
                # Archive with base directory name included
                parent_dir = posixpath.dirname(src) or "."
                base_name = posixpath.basename(src)
                execute(
                    self.vm,
                    ["tar", create_flag, out_path, "-C", parent_dir, base_name],
                    timeout=self._DEFAULT_TIMEOUT_SECONDS,
                    error_message="Failed to create tar archive",
                )
            else:
                # Archive contents without base directory name
                execute(
                    self.vm,
                    ["tar", create_flag, out_path, "-C", src, "."],
                    timeout=self._DEFAULT_TIMEOUT_SECONDS,
                    error_message="Failed to create tar archive",
                )
        except CommandExecutionError as exc:
            raise RuntimeError(str(exc)) from exc

        return SandboxFile(path=out_path)
