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

import httpx
from sqlalchemy.orm import Session

from configs import dify_config
from core.helper import ssrf_proxy
from extensions.ext_database import db as global_db
from extensions.ext_storage import storage
from models.model import MessageFile
from models.tools import ToolFile

logger = logging.getLogger(__name__)

from sqlalchemy.engine import Engine


class ToolFileManager:
    _engine: Engine

    def __init__(self, engine: Engine | None = None):
        if engine is None:
            engine = global_db.engine
        self._engine = engine

    @staticmethod
    def sign_file(tool_file_id: str, extension: str) -> str:
        """
        sign file to get a temporary url
        """
        base_url = dify_config.FILES_URL
        file_preview_url = f"{base_url}/files/tools/{tool_file_id}{extension}"

        timestamp = str(int(time.time()))
        nonce = os.urandom(16).hex()
        data_to_sign = f"file-preview|{tool_file_id}|{timestamp}|{nonce}"
        secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
        sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
        encoded_sign = base64.urlsafe_b64encode(sign).decode()

        return f"{file_preview_url}?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"

    @staticmethod
    def verify_file(file_id: str, timestamp: str, nonce: str, sign: str) -> bool:
        """
        verify signature
        """
        data_to_sign = f"file-preview|{file_id}|{timestamp}|{nonce}"
        secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
        recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
        recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

        # verify signature
        if sign != recalculated_encoded_sign:
            return False

        current_time = int(time.time())
        return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT

    def create_file_by_raw(
        self,
        *,
        user_id: str,
        tenant_id: str,
        conversation_id: Optional[str],
        file_binary: bytes,
        mimetype: str,
        filename: Optional[str] = None,
    ) -> ToolFile:
        extension = guess_extension(mimetype) or ".bin"
        unique_name = uuid4().hex
        unique_filename = f"{unique_name}{extension}"
        # default just as before
        present_filename = unique_filename
        if filename is not None:
            has_extension = len(filename.split(".")) > 1
            # Add extension flexibly
            present_filename = filename if has_extension else f"{filename}{extension}"
        filepath = f"tools/{tenant_id}/{unique_filename}"
        storage.save(filepath, file_binary)

        with Session(self._engine, expire_on_commit=False) as session:
            tool_file = ToolFile(
                user_id=user_id,
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                file_key=filepath,
                mimetype=mimetype,
                name=present_filename,
                size=len(file_binary),
            )

            session.add(tool_file)
            session.commit()
            session.refresh(tool_file)

        return tool_file

    def create_file_by_url(
        self,
        user_id: str,
        tenant_id: str,
        file_url: str,
        conversation_id: Optional[str] = None,
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

        with Session(self._engine, expire_on_commit=False) as session:
            tool_file = ToolFile(
                user_id=user_id,
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                file_key=filepath,
                mimetype=mimetype,
                original_url=file_url,
                name=filename,
                size=len(blob),
            )

            session.add(tool_file)
            session.commit()

        return tool_file

    def get_file_binary(self, id: str) -> Union[tuple[bytes, str], None]:
        """
        get file binary

        :param id: the id of the file

        :return: the binary of the file, mime type
        """
        with Session(self._engine, expire_on_commit=False) as session:
            tool_file: ToolFile | None = (
                session.query(ToolFile)
                .filter(
                    ToolFile.id == id,
                )
                .first()
            )

        if not tool_file:
            return None

        blob = storage.load_once(tool_file.file_key)

        return blob, tool_file.mimetype

    def get_file_binary_by_message_file_id(self, id: str) -> Union[tuple[bytes, str], None]:
        """
        get file binary

        :param id: the id of the file

        :return: the binary of the file, mime type
        """
        with Session(self._engine, expire_on_commit=False) as session:
            message_file: MessageFile | None = (
                session.query(MessageFile)
                .filter(
                    MessageFile.id == id,
                )
                .first()
            )

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

            tool_file: ToolFile | None = (
                session.query(ToolFile)
                .filter(
                    ToolFile.id == tool_file_id,
                )
                .first()
            )

        if not tool_file:
            return None

        blob = storage.load_once(tool_file.file_key)

        return blob, tool_file.mimetype

    def get_file_generator_by_tool_file_id(self, tool_file_id: str) -> tuple[Optional[Generator], Optional[ToolFile]]:
        """
        get file binary

        :param tool_file_id: the id of the tool file

        :return: the binary of the file, mime type
        """
        with Session(self._engine, expire_on_commit=False) as session:
            tool_file: ToolFile | None = (
                session.query(ToolFile)
                .filter(
                    ToolFile.id == tool_file_id,
                )
                .first()
            )

        if not tool_file:
            return None, None

        stream = storage.load_stream(tool_file.file_key)

        return stream, tool_file


# init tool_file_parser
from core.file.tool_file_parser import set_tool_file_manager_factory


def _factory() -> ToolFileManager:
    return ToolFileManager()


set_tool_file_manager_factory(_factory)
