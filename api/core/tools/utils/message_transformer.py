import logging
from collections.abc import Generator
from datetime import date, datetime
from decimal import Decimal
from mimetypes import guess_extension
from uuid import UUID

import numpy as np
import pytz

from core.file import File, FileTransferMethod, FileType
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool_file_manager import ToolFileManager
from libs.login import current_user
from models import Account

logger = logging.getLogger(__name__)


def safe_json_value(v):
    if isinstance(v, datetime):
        tz_name = "UTC"
        if isinstance(current_user, Account) and current_user.timezone is not None:
            tz_name = current_user.timezone
        return v.astimezone(pytz.timezone(tz_name)).isoformat()
    elif isinstance(v, date):
        return v.isoformat()
    elif isinstance(v, UUID):
        return str(v)
    elif isinstance(v, Decimal):
        return float(v)
    elif isinstance(v, bytes):
        try:
            return v.decode("utf-8")
        except UnicodeDecodeError:
            return v.hex()
    elif isinstance(v, memoryview):
        return v.tobytes().hex()
    elif isinstance(v, np.ndarray):
        return v.tolist()
    elif isinstance(v, dict):
        return safe_json_dict(v)
    elif isinstance(v, list | tuple | set):
        return [safe_json_value(i) for i in v]
    else:
        return v


def safe_json_dict(d: dict):
    if not isinstance(d, dict):
        raise TypeError("safe_json_dict() expects a dictionary (dict) as input")
    return {k: safe_json_value(v) for k, v in d.items()}


class ToolFileMessageTransformer:
    @classmethod
    def transform_tool_invoke_messages(
        cls,
        messages: Generator[ToolInvokeMessage, None, None],
        user_id: str,
        tenant_id: str,
        conversation_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Transform tool message and handle file download
        """
        for message in messages:
            if message.type in {ToolInvokeMessage.MessageType.TEXT, ToolInvokeMessage.MessageType.LINK}:
                yield message
            elif message.type == ToolInvokeMessage.MessageType.IMAGE and isinstance(
                message.message, ToolInvokeMessage.TextMessage
            ):
                # try to download image
                try:
                    assert isinstance(message.message, ToolInvokeMessage.TextMessage)
                    tool_file_manager = ToolFileManager()
                    tool_file = tool_file_manager.create_file_by_url(
                        user_id=user_id,
                        tenant_id=tenant_id,
                        file_url=message.message.text,
                        conversation_id=conversation_id,
                    )

                    url = f"/files/tools/{tool_file.id}{guess_extension(tool_file.mimetype) or '.png'}"

                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                        message=ToolInvokeMessage.TextMessage(text=url),
                        meta=message.meta.copy() if message.meta is not None else {},
                    )
                except Exception as e:
                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.TEXT,
                        message=ToolInvokeMessage.TextMessage(
                            text=f"Failed to download image: {message.message.text}: {e}"
                        ),
                        meta=message.meta.copy() if message.meta is not None else {},
                    )
            elif message.type == ToolInvokeMessage.MessageType.BLOB:
                # get mime type and save blob to storage
                meta = message.meta or {}

                mimetype = meta.get("mime_type", "application/octet-stream")
                # get filename from meta
                filename = meta.get("filename", None)
                # if message is str, encode it to bytes

                if not isinstance(message.message, ToolInvokeMessage.BlobMessage):
                    raise ValueError("unexpected message type")

                assert isinstance(message.message.blob, bytes)
                tool_file_manager = ToolFileManager()
                tool_file = tool_file_manager.create_file_by_raw(
                    user_id=user_id,
                    tenant_id=tenant_id,
                    conversation_id=conversation_id,
                    file_binary=message.message.blob,
                    mimetype=mimetype,
                    filename=filename,
                )

                url = cls.get_tool_file_url(tool_file_id=tool_file.id, extension=guess_extension(tool_file.mimetype))

                # check if file is image
                if "image" in mimetype:
                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                        message=ToolInvokeMessage.TextMessage(text=url),
                        meta=meta.copy() if meta is not None else {},
                    )
                else:
                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.BINARY_LINK,
                        message=ToolInvokeMessage.TextMessage(text=url),
                        meta=meta.copy() if meta is not None else {},
                    )
            elif message.type == ToolInvokeMessage.MessageType.FILE:
                meta = message.meta or {}
                file = meta.get("file", None)
                if isinstance(file, File):
                    if file.transfer_method == FileTransferMethod.TOOL_FILE:
                        assert file.related_id is not None
                        url = cls.get_tool_file_url(tool_file_id=file.related_id, extension=file.extension)
                        if file.type == FileType.IMAGE:
                            yield ToolInvokeMessage(
                                type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                                message=ToolInvokeMessage.TextMessage(text=url),
                                meta=meta.copy() if meta is not None else {},
                            )
                        else:
                            yield ToolInvokeMessage(
                                type=ToolInvokeMessage.MessageType.LINK,
                                message=ToolInvokeMessage.TextMessage(text=url),
                                meta=meta.copy() if meta is not None else {},
                            )
                    else:
                        yield message

            elif message.type == ToolInvokeMessage.MessageType.JSON:
                if isinstance(message.message, ToolInvokeMessage.JsonMessage):
                    message.message.json_object = safe_json_value(message.message.json_object)
                yield message
            else:
                yield message

    @classmethod
    def get_tool_file_url(cls, tool_file_id: str, extension: str | None) -> str:
        return f"/files/tools/{tool_file_id}{extension or '.bin'}"
