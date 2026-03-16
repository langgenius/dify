from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel, Field, model_validator

from dify_graph.model_runtime.entities.message_entities import ImagePromptMessageContent

from . import helpers
from .constants import FILE_MODEL_IDENTITY
from .enums import FileTransferMethod, FileType


def sign_tool_file(*, tool_file_id: str, extension: str, for_external: bool = True) -> str:
    """Compatibility shim for tests and legacy callers patching ``models.sign_tool_file``."""
    return helpers.get_signed_tool_file_url(
        tool_file_id=tool_file_id,
        extension=extension,
        for_external=for_external,
    )


class ImageConfig(BaseModel):
    """
    NOTE: This part of validation is deprecated, but still used in app features "Image Upload".
    """

    number_limits: int = 0
    transfer_methods: Sequence[FileTransferMethod] = Field(default_factory=list)
    detail: ImagePromptMessageContent.DETAIL | None = None


class FileUploadConfig(BaseModel):
    """
    File Upload Entity.
    """

    image_config: ImageConfig | None = None
    allowed_file_types: Sequence[FileType] = Field(default_factory=list)
    allowed_file_extensions: Sequence[str] = Field(default_factory=list)
    allowed_file_upload_methods: Sequence[FileTransferMethod] = Field(default_factory=list)
    number_limits: int = 0


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
    # Opaque workflow-layer reference for files resolved outside ``dify_graph``.
    reference: str | None = None
    filename: str | None = None
    extension: str | None = Field(default=None, description="File extension, should contain dot")
    mime_type: str | None = None
    size: int = -1

    def __init__(
        self,
        *,
        id: str | None = None,
        type: FileType,
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
    ):
        legacy_record_id = tool_file_id or upload_file_id or datasource_file_id or related_id
        normalized_reference = reference
        if normalized_reference is None and legacy_record_id is not None:
            normalized_reference = str(legacy_record_id)

        super().__init__(
            id=id,
            type=type,
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

    def to_dict(self) -> Mapping[str, str | int | None]:
        data = self.model_dump(mode="json")
        return {
            **data,
            "related_id": self.reference,
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
        match self.transfer_method:
            case FileTransferMethod.REMOTE_URL:
                if not self.remote_url:
                    raise ValueError("Missing file url")
                if not isinstance(self.remote_url, str) or not self.remote_url.startswith("http"):
                    raise ValueError("Invalid file url")
            case FileTransferMethod.LOCAL_FILE:
                if not self.reference:
                    raise ValueError("Missing file reference")
            case FileTransferMethod.TOOL_FILE:
                if not self.reference:
                    raise ValueError("Missing file reference")
            case FileTransferMethod.DATASOURCE_FILE:
                if not self.reference:
                    raise ValueError("Missing file reference")
        return self

    @property
    def related_id(self) -> str | None:
        return self.reference

    @related_id.setter
    def related_id(self, value: str | None) -> None:
        self.reference = value

    @property
    def storage_key(self) -> str:
        return ""
