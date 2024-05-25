import base64
import hashlib
import hmac
import logging
import os
import time
from collections.abc import Generator
from mimetypes import guess_extension, guess_type
from typing import Optional, Union
from uuid import uuid4

from flask import current_app
from httpx import get

from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import MessageFile
from models.tools import ToolFile

logger = logging.getLogger(__name__)


class ToolFileManager:
    @staticmethod
    def sign_file(tool_file_id: str, extension: str) -> str:
        """
        sign file to get a temporary url
        """
        base_url = current_app.config.get('FILES_URL')
        file_preview_url = f'{base_url}/files/tools/{tool_file_id}{extension}'

        timestamp = str(int(time.time()))
        nonce = os.urandom(16).hex()
        data_to_sign = f"file-preview|{tool_file_id}|{timestamp}|{nonce}"
        secret_key = current_app.config['SECRET_KEY'].encode()
        sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
        encoded_sign = base64.urlsafe_b64encode(sign).decode()

        return f"{file_preview_url}?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"

    @staticmethod
    def verify_file(file_id: str, timestamp: str, nonce: str, sign: str) -> bool:
        """
        verify signature
        """
        data_to_sign = f"file-preview|{file_id}|{timestamp}|{nonce}"
        secret_key = current_app.config['SECRET_KEY'].encode()
        recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
        recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

        # verify signature
        if sign != recalculated_encoded_sign:
            return False

        current_time = int(time.time())
        return current_time - int(timestamp) <= current_app.config.get('FILES_ACCESS_TIMEOUT')

    @staticmethod
    def create_file_by_raw(user_id: str, tenant_id: str,
                           conversation_id: Optional[str], file_binary: bytes,
                           mimetype: str
                           ) -> ToolFile:
        """
        create file
        """
        extension = guess_extension(mimetype) or '.bin'
        unique_name = uuid4().hex
        filename = f"tools/{tenant_id}/{unique_name}{extension}"
        storage.save(filename, file_binary)

        tool_file = ToolFile(user_id=user_id, tenant_id=tenant_id,
                             conversation_id=conversation_id, file_key=filename, mimetype=mimetype)

        db.session.add(tool_file)
        db.session.commit()

        return tool_file

    @staticmethod
    def create_file_by_url(user_id: str, tenant_id: str,
                           conversation_id: str, file_url: str,
                           ) -> ToolFile:
        """
        create file
        """
        # try to download image
        response = get(file_url)
        response.raise_for_status()
        blob = response.content
        mimetype = guess_type(file_url)[0] or 'octet/stream'
        extension = guess_extension(mimetype) or '.bin'
        unique_name = uuid4().hex
        filename = f"tools/{tenant_id}/{unique_name}{extension}"
        storage.save(filename, blob)

        tool_file = ToolFile(user_id=user_id, tenant_id=tenant_id,
                             conversation_id=conversation_id, file_key=filename,
                             mimetype=mimetype, original_url=file_url)

        db.session.add(tool_file)
        db.session.commit()

        return tool_file

    @staticmethod
    def create_file_by_key(user_id: str, tenant_id: str,
                           conversation_id: str, file_key: str,
                           mimetype: str
                           ) -> ToolFile:
        """
        create file
        """
        tool_file = ToolFile(user_id=user_id, tenant_id=tenant_id,
                             conversation_id=conversation_id, file_key=file_key, mimetype=mimetype)
        return tool_file

    @staticmethod
    def get_file_binary(id: str) -> Union[tuple[bytes, str], None]:
        """
        get file binary

        :param id: the id of the file

        :return: the binary of the file, mime type
        """
        tool_file: ToolFile = db.session.query(ToolFile).filter(
            ToolFile.id == id,
        ).first()

        if not tool_file:
            return None

        blob = storage.load_once(tool_file.file_key)

        return blob, tool_file.mimetype

    @staticmethod
    def get_file_binary_by_message_file_id(id: str) -> Union[tuple[bytes, str], None]:
        """
        get file binary

        :param id: the id of the file

        :return: the binary of the file, mime type
        """
        message_file: MessageFile = db.session.query(MessageFile).filter(
            MessageFile.id == id,
        ).first()

        # get tool file id
        tool_file_id = message_file.url.split('/')[-1]
        # trim extension
        tool_file_id = tool_file_id.split('.')[0]

        tool_file: ToolFile = db.session.query(ToolFile).filter(
            ToolFile.id == tool_file_id,
        ).first()

        if not tool_file:
            return None

        blob = storage.load_once(tool_file.file_key)

        return blob, tool_file.mimetype

    @staticmethod
    def get_file_generator_by_tool_file_id(tool_file_id: str) -> Union[tuple[Generator, str], None]:
        """
        get file binary

        :param tool_file_id: the id of the tool file

        :return: the binary of the file, mime type
        """
        tool_file: ToolFile = db.session.query(ToolFile).filter(
            ToolFile.id == tool_file_id,
        ).first()

        if not tool_file:
            return None

        generator = storage.load_stream(tool_file.file_key)

        return generator, tool_file.mimetype


# init tool_file_parser
from core.file.tool_file_parser import tool_file_manager

tool_file_manager['manager'] = ToolFileManager
