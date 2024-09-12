import enum
from typing import Any, Optional

from pydantic import BaseModel

from core.file.tool_file_parser import ToolFileParser
from core.file.upload_file_parser import UploadFileParser
from core.model_runtime.entities.message_entities import ImagePromptMessageContent
from extensions.ext_database import db


class FileExtraConfig(BaseModel):
    """
    File Upload Entity.
    """

    image_config: Optional[dict[str, Any]] = None


class FileType(enum.Enum):
    IMAGE = "image"

    @staticmethod
    def value_of(value):
        for member in FileType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class FileTransferMethod(enum.Enum):
    REMOTE_URL = "remote_url"
    LOCAL_FILE = "local_file"
    TOOL_FILE = "tool_file"

    @staticmethod
    def value_of(value):
        for member in FileTransferMethod:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class FileBelongsTo(enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"

    @staticmethod
    def value_of(value):
        for member in FileBelongsTo:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class FileVar(BaseModel):
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

    def to_dict(self) -> dict:
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

    def to_markdown(self) -> str:
        """
        Convert file to markdown
        :return:
        """
        preview_url = self.preview_url
        if self.type == FileType.IMAGE:
            text = f'![{self.filename or ""}]({preview_url})'
        else:
            text = f"[{self.filename or preview_url}]({preview_url})"

        return text

    @property
    def data(self) -> Optional[str]:
        """
        Get image data, file signed url or base64 data
        depending on config MULTIMODAL_SEND_IMAGE_FORMAT
        :return:
        """
        return self._get_data()

    @property
    def preview_url(self) -> Optional[str]:
        """
        Get signed preview url
        :return:
        """
        return self._get_data(force_url=True)

    @property
    def prompt_message_content(self) -> ImagePromptMessageContent:
        if self.type == FileType.IMAGE:
            image_config = self.extra_config.image_config

            return ImagePromptMessageContent(
                data=self.data,
                detail=ImagePromptMessageContent.DETAIL.HIGH
                if image_config.get("detail") == "high"
                else ImagePromptMessageContent.DETAIL.LOW,
            )

    def _get_data(self, force_url: bool = False) -> Optional[str]:
        from models.model import UploadFile

        if self.type == FileType.IMAGE:
            if self.transfer_method == FileTransferMethod.REMOTE_URL:
                return self.url
            elif self.transfer_method == FileTransferMethod.LOCAL_FILE:
                upload_file = (
                    db.session.query(UploadFile)
                    .filter(UploadFile.id == self.related_id, UploadFile.tenant_id == self.tenant_id)
                    .first()
                )

                return UploadFileParser.get_image_data(upload_file=upload_file, force_url=force_url)
            elif self.transfer_method == FileTransferMethod.TOOL_FILE:
                extension = self.extension
                # add sign url
                return ToolFileParser.get_tool_file_manager().sign_file(
                    tool_file_id=self.related_id, extension=extension
                )

        return None
