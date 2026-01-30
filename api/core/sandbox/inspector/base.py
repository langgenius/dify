from __future__ import annotations

import abc

from core.sandbox.entities.files import SandboxFileDownloadTicket, SandboxFileNode


class SandboxFileSource(abc.ABC):
    _LIST_TIMEOUT_SECONDS = 30
    _UPLOAD_TIMEOUT_SECONDS = 60 * 10
    _EXPORT_EXPIRES_IN_SECONDS = 60 * 10

    def __init__(self, *, tenant_id: str, sandbox_id: str):
        self._tenant_id = tenant_id
        self._sandbox_id = sandbox_id

    @abc.abstractmethod
    def exists(self) -> bool:
        """Check if the sandbox source exists and is available.

        Returns:
            True if the sandbox source exists and can be accessed, False otherwise.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def list_files(self, *, path: str, recursive: bool) -> list[SandboxFileNode]:
        raise NotImplementedError

    @abc.abstractmethod
    def download_file(self, *, path: str) -> SandboxFileDownloadTicket:
        raise NotImplementedError
