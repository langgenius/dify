from __future__ import annotations

import abc

from core.sandbox.entities.files import SandboxFileDownloadTicket, SandboxFileNode


class SandboxFileSource(abc.ABC):
    _LIST_TIMEOUT_SECONDS = 30
    _UPLOAD_TIMEOUT_SECONDS = 60 * 10
    _EXPORT_EXPIRES_IN_SECONDS = 60 * 10

    def __init__(self, *, tenant_id: str, app_id: str, sandbox_id: str):
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._sandbox_id = sandbox_id

    @staticmethod
    def _guess_image_content_type(path: str) -> str | None:
        image_mime_types = {
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
            "gif": "image/gif",
            "bmp": "image/bmp",
            "tiff": "image/tiff",
            "tif": "image/tiff",
            "webp": "image/webp",
            "svg": "image/svg+xml",
            "ico": "image/vnd.microsoft.icon",
            "heif": "image/heif",
            "heic": "image/heic",
        }

        extension = path.split(".")[-1]
        return image_mime_types.get(extension)

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
