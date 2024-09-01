from collections.abc import Mapping, Sequence
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from core.model_runtime.entities.message_entities import ImagePromptMessageContent

from . import helpers
from .enums import FileTransferMethod, FileType
from .tool_file_parser import ToolFileParser


class ImageConfig(BaseModel):
    """
    NOTE: This part of validation is deprecated, but still used in app features "Image Upload".
    """

    number_limits: int = 0
    transfer_methods: Sequence[FileTransferMethod] = Field(default_factory=list)
    detail: ImagePromptMessageContent.DETAIL | None = None


class FileExtraConfig(BaseModel):
    """
    File Upload Entity.
    """

    image_config: Optional[ImageConfig] = None
    allowed_file_types: Sequence[FileType] = Field(default_factory=list)
    allowed_extensions: Sequence[str] = Field(default_factory=list)
    allowed_upload_methods: Sequence[FileTransferMethod] = Field(default_factory=list)
    number_limits: int = 0


class File(BaseModel):
    id: Optional[str] = None  # message file id
    tenant_id: str
    type: FileType
    transfer_method: FileTransferMethod
    url: Optional[str] = None  # remote url
    related_id: Optional[str] = None
    extra_config: Optional[FileExtraConfig] = None
    filename: Optional[str] = None
    extension: Optional[str] = None
    mime_type: Optional[str] = None

    def to_dict(self) -> Mapping[str, str | None]:
        return {
            "__variant": self.__class__.__name__,
            "tenant_id": self.tenant_id,
            "type": self.type.value,
            "transfer_method": self.transfer_method.value,
            "url": self.preview_url,
            "remote_url": self.url,
            "related_id": self.related_id,
            "filename": self.filename,
            "extension": self.extension,
            "mime_type": self.mime_type,
        }

    @property
    def markdown(self) -> str:
        preview_url = self.preview_url
        if self.type == FileType.IMAGE:
            text = f'![{self.filename or ""}]({preview_url})'
        else:
            text = f"[{self.filename or preview_url}]({preview_url})"

        return text

    @property
    def preview_url(self) -> Optional[str]:
        if self.type == FileType.IMAGE:
            if self.transfer_method == FileTransferMethod.REMOTE_URL:
                return self.url
            elif self.transfer_method == FileTransferMethod.LOCAL_FILE:
                if self.related_id is None:
                    raise ValueError("Missing file related_id")
                return helpers.get_signed_image_url(upload_file_id=self.related_id)
            elif self.transfer_method == FileTransferMethod.TOOL_FILE:
                assert self.related_id is not None
                assert self.extension is not None
                return ToolFileParser.get_tool_file_manager().sign_file(
                    tool_file_id=self.related_id, extension=self.extension
                )

        return None

    @model_validator(mode="after")
    def validate_after(self):
        match self.transfer_method:
            case FileTransferMethod.REMOTE_URL:
                if not self.url:
                    raise ValueError("Missing file url")
                if not isinstance(self.url, str) or not self.url.startswith("http"):
                    raise ValueError("Invalid file url")
            case FileTransferMethod.LOCAL_FILE:
                if not self.related_id:
                    raise ValueError("Missing file related_id")
            case FileTransferMethod.TOOL_FILE:
                if not self.related_id:
                    raise ValueError("Missing file related_id")

        # Validate the extra config.
        if not self.extra_config:
            return self

        if self.extra_config.allowed_file_types:
            if self.type not in self.extra_config.allowed_file_types and self.type != FileType.CUSTOM:
                raise ValueError(f"Invalid file type: {self.type}")

        if self.extra_config.allowed_extensions and self.extension not in self.extra_config.allowed_extensions:
            raise ValueError(f"Invalid file extension: {self.extension}")

        if (
            self.extra_config.allowed_upload_methods
            and self.transfer_method not in self.extra_config.allowed_upload_methods
        ):
            raise ValueError(f"Invalid transfer method: {self.transfer_method}")

        match self.type:
            case FileType.IMAGE:
                # NOTE: This part of validation is deprecated, but still used in app features "Image Upload".
                if not self.extra_config.image_config:
                    return self
                # TODO: skip check if transfer_methods is empty, because many test cases are not setting this field
                if (
                    self.extra_config.image_config.transfer_methods
                    and self.transfer_method not in self.extra_config.image_config.transfer_methods
                ):
                    raise ValueError(f"Invalid transfer method: {self.transfer_method}")

        return self
