from collections.abc import Mapping, Sequence
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from core.model_runtime.entities.message_entities import ImagePromptMessageContent

from . import helpers
from .constants import FILE_MODEL_IDENTITY
from .enums import FileTransferMethod, FileType
from .tool_file_parser import ToolFileParser


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

    image_config: Optional[ImageConfig] = None
    allowed_file_types: Sequence[FileType] = Field(default_factory=list)
    allowed_extensions: Sequence[str] = Field(default_factory=list)
    allowed_upload_methods: Sequence[FileTransferMethod] = Field(default_factory=list)
    number_limits: int = 0


class File(BaseModel):
    dify_model_identity: str = FILE_MODEL_IDENTITY

    id: Optional[str] = None  # message file id
    tenant_id: str
    type: FileType
    transfer_method: FileTransferMethod
    remote_url: Optional[str] = None  # remote url
    related_id: Optional[str] = None
    filename: Optional[str] = None
    extension: Optional[str] = Field(default=None, description="File extension, should contains dot")
    mime_type: Optional[str] = None
    size: int = -1

    def to_dict(self) -> Mapping[str, str | int | None]:
        data = self.model_dump(mode="json")
        return {
            **data,
            "url": self.generate_url(),
        }

    @property
    def markdown(self) -> str:
        url = self.generate_url()
        if self.type == FileType.IMAGE:
            text = f'![{self.filename or ""}]({url})'
        else:
            text = f"[{self.filename or url}]({url})"

        return text

    def generate_url(self) -> Optional[str]:
        if self.type == FileType.IMAGE:
            if self.transfer_method == FileTransferMethod.REMOTE_URL:
                return self.remote_url
            elif self.transfer_method == FileTransferMethod.LOCAL_FILE:
                if self.related_id is None:
                    raise ValueError("Missing file related_id")
                return helpers.get_signed_file_url(upload_file_id=self.related_id)
            elif self.transfer_method == FileTransferMethod.TOOL_FILE:
                assert self.related_id is not None
                assert self.extension is not None
                return ToolFileParser.get_tool_file_manager().sign_file(
                    tool_file_id=self.related_id, extension=self.extension
                )
        else:
            if self.transfer_method == FileTransferMethod.REMOTE_URL:
                return self.remote_url
            elif self.transfer_method == FileTransferMethod.LOCAL_FILE:
                if self.related_id is None:
                    raise ValueError("Missing file related_id")
                return helpers.get_signed_file_url(upload_file_id=self.related_id)
            elif self.transfer_method == FileTransferMethod.TOOL_FILE:
                assert self.related_id is not None
                assert self.extension is not None
                return ToolFileParser.get_tool_file_manager().sign_file(
                    tool_file_id=self.related_id, extension=self.extension
                )

    @model_validator(mode="after")
    def validate_after(self):
        match self.transfer_method:
            case FileTransferMethod.REMOTE_URL:
                if not self.remote_url:
                    raise ValueError("Missing file url")
                if not isinstance(self.remote_url, str) or not self.remote_url.startswith("http"):
                    raise ValueError("Invalid file url")
            case FileTransferMethod.LOCAL_FILE:
                if not self.related_id:
                    raise ValueError("Missing file related_id")
            case FileTransferMethod.TOOL_FILE:
                if not self.related_id:
                    raise ValueError("Missing file related_id")
        return self
