from __future__ import annotations

import base64
import json
from collections.abc import Mapping, Sequence
from typing import Any, assert_never

from pydantic import BaseModel, Field, model_validator

from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent

from . import helpers
from .constants import FILE_MODEL_IDENTITY
from .enums import FileTransferMethod, FileType

_FILE_REFERENCE_PREFIX = "dify-file-ref:"


class _FileConstructorConflictError(Exception):
    """Raised when multiple constructor inputs disagree on file identity."""


def sign_tool_file(
    *,
    tool_file_id: str,
    extension: str,
    for_external: bool = True,
) -> str:
    """Return a signed tool-file URL shim for tests and legacy patches."""
    return helpers.get_signed_tool_file_url(
        tool_file_id=tool_file_id,
        extension=extension,
        for_external=for_external,
    )


class ImageConfig(BaseModel):
    """NOTE: This part of validation is deprecated, but still used in app
    features "Image Upload".
    """

    number_limits: int = 0
    transfer_methods: Sequence[FileTransferMethod] = Field(default_factory=list)
    detail: ImagePromptMessageContent.DETAIL | None = None


class FileUploadConfig(BaseModel):
    """File Upload Entity."""

    image_config: ImageConfig | None = None
    allowed_file_types: Sequence[FileType] = Field(default_factory=list)
    allowed_file_extensions: Sequence[str] = Field(default_factory=list)
    allowed_file_upload_methods: Sequence[FileTransferMethod] = Field(
        default_factory=list,
    )
    number_limits: int = 0


def _parse_reference(reference: str | None) -> tuple[str | None, str | None]:
    """Best-effort parser for record references and historical storage-key payloads."""
    if not reference:
        return None, None

    if not reference.startswith(_FILE_REFERENCE_PREFIX):
        return reference, None

    encoded_payload = reference.removeprefix(_FILE_REFERENCE_PREFIX)
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded_payload.encode()))
    except (ValueError, json.JSONDecodeError):
        return reference, None

    record_id = payload.get("record_id")
    if not isinstance(record_id, str) or not record_id:
        return reference, None

    storage_key = payload.get("storage_key")
    if not isinstance(storage_key, str):
        storage_key = None

    return record_id, storage_key


class File(BaseModel):
    """Graph-owned file reference.

    The graph layer deliberately keeps only the metadata required to route,
    serialize, and render files. Application ownership concerns such as
    tenant/user/conversation identity stay in the workflow/storage layer.
    """

    # NOTE: dify_model_identity is a special identifier used to distinguish between
    # new and old data formats during serialization and deserialization.
    dify_model_identity: str = FILE_MODEL_IDENTITY

    id: str | None = None  # message file id
    type: FileType
    transfer_method: FileTransferMethod
    # If `transfer_method` is `FileTransferMethod.remote_url`, the
    # `remote_url` attribute must not be `None`.
    remote_url: str | None = None  # remote url
    # Opaque workflow-layer reference for files resolved outside ``graphon``.
    # New payloads only carry the backing record id; historical payloads may
    # still include storage_key and must remain readable.
    reference: str | None = None
    filename: str | None = None
    extension: str | None = Field(
        default=None,
        description="File extension, should contain dot",
    )
    mime_type: str | None = None
    size: int = -1
    _storage_key: str

    def __init__(
        self,
        *,
        file_id: str | None = None,
        tenant_id: str | None = None,
        file_type: FileType | None = None,
        transfer_method: FileTransferMethod,
        remote_url: str | None = None,
        reference: str | None = None,
        related_id: str | None = None,
        filename: str | None = None,
        extension: str | None = None,
        mime_type: str | None = None,
        size: int = -1,
        storage_key: str | None = None,
        dify_model_identity: str | None = FILE_MODEL_IDENTITY,
        url: str | None = None,
        # Legacy compatibility fields - explicitly accept known extra fields
        tool_file_id: str | None = None,
        upload_file_id: str | None = None,
        datasource_file_id: str | None = None,
        **legacy_kwargs: Any,
    ) -> None:
        legacy_id = legacy_kwargs.pop("id", None)
        legacy_type = legacy_kwargs.pop("type", None)
        if legacy_kwargs:
            unexpected_keys = ", ".join(sorted(legacy_kwargs))
            msg = f"Unexpected keyword arguments: {unexpected_keys}"
            raise TypeError(msg)

        legacy_record_id = (
            related_id or tool_file_id or upload_file_id or datasource_file_id
        )
        if legacy_id is not None and file_id is not None and legacy_id != file_id:
            msg = "Conflicting file identifiers"
            raise _FileConstructorConflictError(msg)
        if (
            legacy_type is not None
            and file_type is not None
            and legacy_type != file_type
        ):
            msg = "Conflicting file types"
            raise _FileConstructorConflictError(msg)

        normalized_reference = reference
        if normalized_reference is None and legacy_record_id is not None:
            normalized_reference = str(legacy_record_id)
        _, parsed_storage_key = _parse_reference(normalized_reference)
        normalized_file_id = file_id if file_id is not None else legacy_id
        normalized_file_type = file_type if file_type is not None else legacy_type

        super().__init__(
            id=normalized_file_id,
            type=normalized_file_type,
            transfer_method=transfer_method,
            remote_url=remote_url,
            reference=normalized_reference,
            filename=filename,
            extension=extension,
            mime_type=mime_type,
            size=size,
            dify_model_identity=dify_model_identity,
            url=url,
        )
        # Accept legacy constructor fields without promoting them
        # back into the graph model.
        _ = tenant_id
        self._storage_key = storage_key or parsed_storage_key or ""

    def to_dict(self) -> Mapping[str, str | int | None]:
        data = self.model_dump(mode="json")
        return {
            **data,
            "related_id": self.related_id,
            "url": self.generate_url(),
        }

    @property
    def markdown(self) -> str:
        url = self.generate_url()
        if self.type == FileType.IMAGE:
            text = f"![{self.filename or ''}]({url})"
        else:
            text = f"[{self.filename or url}]({url})"

        return text

    def generate_url(self, for_external: bool = True) -> str | None:
        return helpers.resolve_file_url(self, for_external=for_external)

    def to_plugin_parameter(self) -> dict[str, Any]:
        return {
            "dify_model_identity": FILE_MODEL_IDENTITY,
            "mime_type": self.mime_type,
            "filename": self.filename,
            "extension": self.extension,
            "size": self.size,
            "type": self.type,
            "url": self.generate_url(for_external=False),
        }

    @model_validator(mode="after")
    def validate_after(self) -> File:
        transfer_method = self.transfer_method
        match transfer_method:
            case FileTransferMethod.REMOTE_URL:
                if not self.remote_url:
                    msg = "Missing file url"
                    raise ValueError(msg)
                if not isinstance(
                    self.remote_url,
                    str,
                ) or not self.remote_url.startswith("http"):
                    msg = "Invalid file url"
                    raise ValueError(msg)
            case FileTransferMethod.LOCAL_FILE:
                if not self.reference:
                    msg = "Missing file reference"
                    raise ValueError(msg)
            case FileTransferMethod.TOOL_FILE:
                if not self.reference:
                    msg = "Missing file reference"
                    raise ValueError(msg)
            case FileTransferMethod.DATASOURCE_FILE:
                if not self.reference:
                    msg = "Missing file reference"
                    raise ValueError(msg)
            case _:
                assert_never(transfer_method)
        return self

    @property
    def related_id(self) -> str | None:
        record_id, _ = _parse_reference(self.reference)
        return record_id

    @related_id.setter
    def related_id(self, value: str | None) -> None:
        self.reference = value

    @property
    def storage_key(self) -> str:
        _, storage_key = _parse_reference(self.reference)
        return storage_key or self._storage_key

    @storage_key.setter
    def storage_key(self, value: str) -> None:
        self._storage_key = value
