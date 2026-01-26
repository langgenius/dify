from __future__ import annotations

from core.sandbox.entities.files import SandboxFileDownloadTicket, SandboxFileNode
from core.sandbox.inspector import SandboxFileBrowser


class SandboxFileService:
    @classmethod
    def list_files(
        cls,
        *,
        tenant_id: str,
        sandbox_id: str,
        path: str | None = None,
        recursive: bool = False,
    ) -> list[SandboxFileNode]:
        browser = SandboxFileBrowser(tenant_id=tenant_id, sandbox_id=sandbox_id)
        return browser.list_files(path=path, recursive=recursive)

    @classmethod
    def download_file(cls, *, tenant_id: str, sandbox_id: str, path: str) -> SandboxFileDownloadTicket:
        browser = SandboxFileBrowser(tenant_id=tenant_id, sandbox_id=sandbox_id)
        return browser.download_file(path=path)
