import base64
import enum
import logging
from typing import Optional

import click
from pydantic import BaseModel

from core.app.app_config.entities import FileExtraConfig
from core.file.file_parser_cache import FileParserCache
from core.file.tool_file_parser import ToolFileParser
from core.file.upload_file_parser import UploadFileParser
from core.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    TextPromptMessageContent,
    VideoPromptMessageContent,
)
from extensions.ext_database import db
from models.account import Account
from models.model import App, UploadFile
from services.audio_service import AudioService
from services.extract_video_frames import ExtractVideoFrames
from services.file_service import FileService


class FileType(enum.Enum):
    IMAGE = 'image'
    VIDEO = 'video'

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
    app_id: Optional[str] = None
    description: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            '__variant': self.__class__.__name__,
            'tenant_id': self.tenant_id,
            'type': self.type.value,
            'transfer_method': self.transfer_method.value,
            'url': self.preview_url,
            'related_id': self.related_id,
            'filename': self.filename,
            'extension': self.extension,
            'mime_type': self.mime_type,
            'description': self.video_text,
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
            text = f'[{self.filename or preview_url}]({preview_url})'

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
    def video_text(self) -> Optional[str]:
        """
        Get video data, file signed url or base64 data
        depending on config MULTIMODAL_SEND_IMAGE_FORMAT
        :return:
        """
        audio_text = self._get_video_text()
        if isinstance(audio_text, bytes):
            audio_data = audio_text.decode('utf-8')
        else:
            audio_data = audio_text
        logging.info(click.style(f"video text: {audio_data}", fg='green'))
        return audio_data

    @property
    def preview_url(self) -> Optional[str]:
        """
        Get signed preview url
        :return:
        """
        return self._get_data(force_url=True)

    @property
    def prompt_message_content(
            self) -> ImagePromptMessageContent | VideoPromptMessageContent | TextPromptMessageContent:
        image_config = self.extra_config.image_config
        video_config = self.extra_config.video_config

        if self.type == FileType.IMAGE:
            return ImagePromptMessageContent(
                data=self.data,
                detail=ImagePromptMessageContent.DETAIL.HIGH
                if image_config.get("detail") == "high" else ImagePromptMessageContent.DETAIL.LOW
            )
        if self.type == FileType.VIDEO:
            if video_config.get('extract_video') != 'enabled' and video_config.get('extract_audio') == 'enabled':
                return TextPromptMessageContent(data=self.video_text)
            elif video_config.get('extract_video') == 'enabled' and video_config.get('extract_audio') != 'enabled':
                return ImagePromptMessageContent(
                    data=self.data,
                    detail=ImagePromptMessageContent.DETAIL.HIGH
                    if image_config.get("detail") == "high" else ImagePromptMessageContent.DETAIL.LOW
                )
            elif video_config.get('extract_video') == 'enabled' and video_config.get('extract_audio') == 'enabled':
                return VideoPromptMessageContent(
                    data=self.data,
                    detail=VideoPromptMessageContent.DETAIL.HIGH
                    if image_config.get("detail") == "high" else VideoPromptMessageContent.DETAIL.LOW,
                    description=self.video_text
                )
            else:
                raise ValueError('Either video frame extraction or audio extraction one of them must be enabled!')

    def _get_data(self, force_url: bool = False) -> Optional[str]:
        if self.type == FileType.IMAGE:
            if self.transfer_method == FileTransferMethod.REMOTE_URL:
                return self.url
            elif self.transfer_method == FileTransferMethod.LOCAL_FILE:
                upload_file = db.session.query(UploadFile).filter(UploadFile.id == self.related_id,
                                                                  UploadFile.tenant_id == self.tenant_id).first()

                file_cache = FileParserCache(file_id=upload_file.id,
                                             file_type=upload_file.extension,
                                             separation_type='image')
                if file_cache.get():
                    image_data = file_cache.get()
                else:
                    image_data = UploadFileParser.get_image_data(upload_file=upload_file, force_url=force_url)
                    file_cache.set(file_content=image_data, ttl=3600)
                return image_data
            elif self.transfer_method == FileTransferMethod.TOOL_FILE:
                extension = self.extension
                # add sign url
                return ToolFileParser.get_tool_file_manager().sign_file(tool_file_id=self.related_id,
                                                                        extension=extension)
        if self.type == FileType.VIDEO:
            video_config = self.extra_config.video_config

            upload_file = db.session.query(UploadFile).filter(UploadFile.id == self.related_id,
                                                              UploadFile.tenant_id == self.tenant_id).first()

            # Video frame extraction and audio extraction
            if video_config.get('extract_video') == 'enabled':
                file_cache = FileParserCache(file_id=upload_file.id,
                                             file_type=upload_file.extension,
                                             separation_type='video')
                if file_cache.get():
                    video_data = file_cache.get()
                else:
                    data = ExtractVideoFrames(max_collect_frames=video_config['max_collect_frames'],
                                              similarity_threshold=video_config['similarity_threshold'],
                                              blur_threshold=video_config['blur_threshold'],
                                              file=upload_file).process_video()
                    if force_url is True:
                        image_upload_file = FileService.upload_file(file=data,
                                                                    file_name=f'{upload_file.name.split(".")[0]}.jpg',
                                                                    tenant_id=upload_file.tenant_id)
                        video_data = UploadFileParser.get_signed_temp_image_url(upload_file_id=image_upload_file.id)
                    else:
                        encoded_string = base64.b64encode(data).decode('utf-8')
                        video_data = f'data:image/jpeg;base64,{encoded_string}'
                    file_cache.set(file_content=video_data, ttl=3600)
                return video_data
        return None

    def _get_video_text(self) -> Optional[str]:
        """
        Get video text data
        :return:
        """
        if self.type == FileType.VIDEO:
            video_config = self.extra_config.video_config

            if video_config.get('extract_audio') == 'enabled':
                upload_file = db.session.query(UploadFile).filter(UploadFile.id == self.related_id,
                                                                  UploadFile.tenant_id == self.tenant_id).first()

                file_cache = FileParserCache(file_id=upload_file.id, file_type=upload_file.extension,
                                             separation_type='audio')
                if file_cache.get():
                    return file_cache.get()
                elif not file_cache.get() and self.app_id:
                    user_info = db.session.query(Account).filter(Account.id == upload_file.created_by).first()
                    app_info = db.session.query(App).filter(App.id == self.app_id).first()

                    audio_text = AudioService.transcript_asr(app_model=app_info, file=upload_file, end_user=user_info)
                    audio_data = audio_text.get('text').strip()
                    file_cache.set(file_content=audio_data)
                    return audio_data
        return None
