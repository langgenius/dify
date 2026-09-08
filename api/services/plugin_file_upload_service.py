"""Application service for signed plugin file uploads."""

from dataclasses import dataclass
from typing import IO, Literal, Protocol

from core.tools.signature import verify_plugin_file_signature
from services.errors.file import FileTooLargeError

PluginUploadUserFrom = Literal["account", "end-user"] | None


class PluginFileUploadAccessDeniedError(PermissionError):
    pass


@dataclass(frozen=True, slots=True)
class PluginFileUploadResult:
    id: str
    reference: str
    name: str
    size: int
    extension: str
    mime_type: str
    preview_url: str
    source_url: str | None
    original_url: str | None
    user_id: str
    tenant_id: str
    conversation_id: str | None
    file_key: str


class PluginFileUploadOwnerQuery(Protocol):
    def owner_exists(
        self,
        *,
        tenant_id: str,
        user_id: str,
        user_from: PluginUploadUserFrom,
    ) -> bool: ...


class PluginFileUploadFiles(Protocol):
    def store(
        self,
        *,
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        content: bytes,
        mimetype: str,
        filename: str,
    ) -> PluginFileUploadResult: ...


class PluginFileUploadService:
    def __init__(
        self,
        *,
        owners: PluginFileUploadOwnerQuery,
        files: PluginFileUploadFiles,
    ) -> None:
        self._owners = owners
        self._files = files

    def upload(
        self,
        *,
        stream: IO[bytes],
        filename: str,
        mimetype: str,
        tenant_id: str,
        user_id: str,
        user_from: PluginUploadUserFrom,
        conversation_id: str | None,
        timestamp: str,
        nonce: str,
        sign: str,
        max_size: int | None,
    ) -> PluginFileUploadResult:
        if not verify_plugin_file_signature(
            filename=filename,
            mimetype=mimetype,
            tenant_id=tenant_id,
            user_id=user_id,
            user_from=user_from,
            conversation_id=conversation_id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
            max_size=max_size,
        ):
            raise PluginFileUploadAccessDeniedError

        if not self._owners.owner_exists(
            tenant_id=tenant_id,
            user_id=user_id,
            user_from=user_from,
        ):
            raise PluginFileUploadAccessDeniedError

        if max_size is None:
            content = stream.read()
        else:
            content = stream.read(max_size + 1)
            if len(content) > max_size:
                raise FileTooLargeError("File size exceeds the signed upload limit.")

        return self._files.store(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            content=content,
            mimetype=mimetype,
            filename=filename,
        )
