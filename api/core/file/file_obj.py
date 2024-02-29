import enum
from typing import Optional

from pydantic import BaseModel

from core.file.upload_file_parser import UploadFileParser
from core.model_runtime.entities.message_entities import ImagePromptMessageContent
from extensions.ext_database import db
from models.model import UploadFile


class FileType(enum.Enum):
    IMAGE = 'image'

    @staticmethod
    def value_of(value):
        for member in FileType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class FileTransferMethod(enum.Enum):
    REMOTE_URL = 'remote_url'
    LOCAL_FILE = 'local_file'
    TOOL_FILE = 'tool_file'

    @staticmethod
    def value_of(value):
        for member in FileTransferMethod:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")

class FileBelongsTo(enum.Enum):
    USER = 'user'
    ASSISTANT = 'assistant'

    @staticmethod
    def value_of(value):
        for member in FileBelongsTo:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")

class FileObj(BaseModel):
    id: Optional[str]
    tenant_id: str
    type: FileType
    transfer_method: FileTransferMethod
    url: Optional[str]
    upload_file_id: Optional[str]
    file_config: dict

    @property
    def data(self) -> Optional[str]:
        return self._get_data()

    @property
    def preview_url(self) -> Optional[str]:
        return self._get_data(force_url=True)

    @property
    def prompt_message_content(self) -> ImagePromptMessageContent:
        if self.type == FileType.IMAGE:
            image_config = self.file_config.get('image')

            return ImagePromptMessageContent(
                data=self.data,
                detail=ImagePromptMessageContent.DETAIL.HIGH
                if image_config.get("detail") == "high" else ImagePromptMessageContent.DETAIL.LOW
            )

    def _get_data(self, force_url: bool = False) -> Optional[str]:
        if self.type == FileType.IMAGE:
            if self.transfer_method == FileTransferMethod.REMOTE_URL:
                return self.url
            elif self.transfer_method == FileTransferMethod.LOCAL_FILE:
                upload_file = (db.session.query(UploadFile)
                               .filter(
                    UploadFile.id == self.upload_file_id,
                    UploadFile.tenant_id == self.tenant_id
                ).first())

                return UploadFileParser.get_image_data(
                    upload_file=upload_file,
                    force_url=force_url
                )

        return None
