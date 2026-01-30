from __future__ import annotations

from pathlib import PurePosixPath

from core.sandbox.entities.files import SandboxFileDownloadTicket, SandboxFileNode
from core.sandbox.inspector.archive_source import SandboxFileArchiveSource
from core.sandbox.inspector.base import SandboxFileSource
from core.sandbox.inspector.runtime_source import SandboxFileRuntimeSource
from core.sandbox.manager import SandboxManager


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

    def exists(self) -> bool:
        """Check if the sandbox source exists and is available."""
        return self._backend().exists()

    def list_files(self, *, path: str | None = None, recursive: bool = False) -> list[SandboxFileNode]:
        workspace_path = self._normalize_workspace_path(path)
        return self._backend().list_files(path=workspace_path, recursive=recursive)

    def download_file(self, *, path: str) -> SandboxFileDownloadTicket:
        workspace_path = self._normalize_workspace_path(path)
        return self._backend().download_file(path=workspace_path)
