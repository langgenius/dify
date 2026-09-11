"""Application service for signed ToolFile downloads."""

from collections.abc import Iterator
from typing import NamedTuple, Protocol

from core.tools.signature import verify_tool_file_signature
from graphon.file import File


class ToolFileDownloadAccessDeniedError(PermissionError):
    pass


class ToolFileDownloadNotFoundError(LookupError):
    pass


class ToolFileDownloadSource(Protocol):
    def get_file_generator_by_tool_file_id(
        self,
        tool_file_id: str,
    ) -> tuple[Iterator[bytes] | None, File | None]: ...


class ToolFileDownload(NamedTuple):
    content: Iterator[bytes]
    mime_type: str | None
    filename: str | None
    size: int


class ToolFileDownloadService:
    def __init__(self, *, tool_files: ToolFileDownloadSource) -> None:
        self._tool_files = tool_files

    def get_signed_file(
        self,
        *,
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
    ) -> ToolFileDownload:
        if not verify_tool_file_signature(
            file_id=file_id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
        ):
            raise ToolFileDownloadAccessDeniedError

        content, file = self._tool_files.get_file_generator_by_tool_file_id(tool_file_id=file_id)
        if content is None or file is None:
            raise ToolFileDownloadNotFoundError

        return ToolFileDownload(
            content=content,
            mime_type=file.mime_type,
            filename=file.filename,
            size=file.size,
        )
