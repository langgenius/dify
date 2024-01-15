import logging

from typing import Union, Tuple, Generator
from uuid import uuid4
from mimetypes import guess_extension, guess_type
from httpx import get

from models.tools import ToolFile

from extensions.ext_database import db
from extensions.ext_storage import storage

logger = logging.getLogger(__name__)

class ToolFileManager:
    @staticmethod
    def create_file_by_raw(user_id: str, tenant_id: str, 
                            conversation_id: str, file_binary: bytes,
                            mimetype: str
    ) -> ToolFile:
        """
        create file
        """
        extension = guess_extension(mimetype) or '.bin'
        unique_name = uuid4().hex
        filename = f"/tools/{tenant_id}/{unique_name}{extension}"
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
        filename = f"/tools/{tenant_id}/{unique_name}{extension}"
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
    def get_file_binary(id: str) -> Union[Tuple[bytes, str], None]:
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
    def get_file_generator(id: str) -> Union[Tuple[Generator, str], None]:
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

        generator = storage.load_stream(tool_file.file_key)

        return generator, tool_file.mimetype