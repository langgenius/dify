import base64
import hashlib
import hmac
import logging
import os
import time
from datetime import datetime
from mimetypes import guess_extension, guess_type
from typing import Union
from uuid import uuid4

import httpx

from configs import dify_config
from core.helper import ssrf_proxy
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.enums import CreatorUserRole
from models.model import MessageFile, UploadFile
from models.tools import ToolFile

logger = logging.getLogger(__name__)


class DatasourceFileManager:
    @staticmethod
    def sign_file(datasource_file_id: str, extension: str) -> str:
        """
        sign file to get a temporary url
        """
        base_url = dify_config.FILES_URL
        file_preview_url = f"{base_url}/files/datasources/{datasource_file_id}{extension}"

        timestamp = str(int(time.time()))
        nonce = os.urandom(16).hex()
        data_to_sign = f"file-preview|{datasource_file_id}|{timestamp}|{nonce}"
        secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
        sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
        encoded_sign = base64.urlsafe_b64encode(sign).decode()

        return f"{file_preview_url}?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"

    @staticmethod
    def verify_file(datasource_file_id: str, timestamp: str, nonce: str, sign: str) -> bool:
        """
        verify signature
        """
        data_to_sign = f"file-preview|{datasource_file_id}|{timestamp}|{nonce}"
        secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
        recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
        recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

        # verify signature
        if sign != recalculated_encoded_sign:
            return False

        current_time = int(time.time())
        return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT

    @staticmethod
    def create_file_by_raw(
        *,
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        file_binary: bytes,
        mimetype: str,
        filename: str | None = None,
    ) -> UploadFile:
        extension = guess_extension(mimetype) or ".bin"
        unique_name = uuid4().hex
        unique_filename = f"{unique_name}{extension}"
        # default just as before
        present_filename = unique_filename
        if filename is not None:
            has_extension = len(filename.split(".")) > 1
            # Add extension flexibly
            present_filename = filename if has_extension else f"{filename}{extension}"
        filepath = f"datasources/{tenant_id}/{unique_filename}"
        storage.save(filepath, file_binary)

        upload_file = UploadFile(
            tenant_id=tenant_id,
            storage_type=dify_config.STORAGE_TYPE,
            key=filepath,
            name=present_filename,
            size=len(file_binary),
            extension=extension,
            mime_type=mimetype,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=user_id,
            used=False,
            hash=hashlib.sha3_256(file_binary).hexdigest(),
            source_url="",
            created_at=datetime.now(),
        )

        db.session.add(upload_file)
        db.session.commit()
        db.session.refresh(upload_file)

        return upload_file

    @staticmethod
    def create_file_by_url(
        user_id: str,
        tenant_id: str,
        file_url: str,
        conversation_id: str | None = None,
    ) -> ToolFile:
        # try to download image
        try:
            response = ssrf_proxy.get(file_url)
            response.raise_for_status()
            blob = response.content
        except httpx.TimeoutException:
            raise ValueError(f"timeout when downloading file from {file_url}")

        mimetype = (
            guess_type(file_url)[0]
            or response.headers.get("Content-Type", "").split(";")[0].strip()
            or "application/octet-stream"
        )
        extension = guess_extension(mimetype) or ".bin"
        unique_name = uuid4().hex
        filename = f"{unique_name}{extension}"
        filepath = f"tools/{tenant_id}/{filename}"
        storage.save(filepath, blob)

        tool_file = ToolFile(
            tenant_id=tenant_id,
            user_id=user_id,
            conversation_id=conversation_id,
            file_key=filepath,
            mimetype=mimetype,
            original_url=file_url,
            name=filename,
            size=len(blob),
        )

        db.session.add(tool_file)
        db.session.commit()

        return tool_file

    @staticmethod
    def get_file_binary(id: str) -> Union[tuple[bytes, str], None]:
        """
        get file binary

        :param id: the id of the file

        :return: the binary of the file, mime type
        """
        upload_file: UploadFile | None = db.session.query(UploadFile).where(UploadFile.id == id).first()

        if not upload_file:
            return None

        blob = storage.load_once(upload_file.key)

        return blob, upload_file.mime_type

    @staticmethod
    def get_file_binary_by_message_file_id(id: str) -> Union[tuple[bytes, str], None]:
        """
        get file binary

        :param id: the id of the file

        :return: the binary of the file, mime type
        """
        message_file: MessageFile | None = db.session.query(MessageFile).where(MessageFile.id == id).first()

        # Check if message_file is not None
        if message_file is not None:
            # get tool file id
            if message_file.url is not None:
                tool_file_id = message_file.url.split("/")[-1]
                # trim extension
                tool_file_id = tool_file_id.split(".")[0]
            else:
                tool_file_id = None
        else:
            tool_file_id = None

        tool_file: ToolFile | None = db.session.query(ToolFile).where(ToolFile.id == tool_file_id).first()

        if not tool_file:
            return None

        blob = storage.load_once(tool_file.file_key)

        return blob, tool_file.mimetype

    @staticmethod
    def get_file_generator_by_upload_file_id(upload_file_id: str):
        """
        get file binary

        :param tool_file_id: the id of the tool file

        :return: the binary of the file, mime type
        """
        upload_file: UploadFile | None = db.session.query(UploadFile).where(UploadFile.id == upload_file_id).first()

        if not upload_file:
            return None, None

        stream = storage.load_stream(upload_file.key)

        return stream, upload_file.mime_type


# init tool_file_parser
# from core.file.datasource_file_parser import datasource_file_manager
#
# datasource_file_manager["manager"] = DatasourceFileManager
