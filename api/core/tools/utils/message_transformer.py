import logging
import re
from collections.abc import Generator
from datetime import date, datetime
from decimal import Decimal
from mimetypes import guess_extension
from typing import Any
from uuid import UUID

import numpy as np
import pytz

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool_file_manager import ToolFileManager
from core.workflow.file_reference import parse_file_reference
from graphon.file import File, FileTransferMethod, FileType
from libs.login import current_user
from models import Account

logger = logging.getLogger(__name__)

_TOOL_FILE_URL_PATTERN = re.compile(r"(?:^|/+)files/tools/(?P<tool_file_id>[^/?#.]+)")


def safe_json_value(v):
    match v:
        case datetime():
            tz_name = "UTC"
            if isinstance(current_user, Account) and current_user.timezone is not None:
                tz_name = current_user.timezone
            return v.astimezone(pytz.timezone(tz_name)).isoformat()
        case date():
            return v.isoformat()
        case UUID():
            return str(v)
        case Decimal():
            return float(v)
        case bytes():
            try:
                return v.decode("utf-8")
            except UnicodeDecodeError:
                return v.hex()
        case memoryview():
            return v.tobytes().hex()
        case np.integer():
            return int(v)
        case np.floating():
            return float(v)
        case np.ndarray():
            return v.tolist()
        case dict():
            return safe_json_dict(v)
        case list() | tuple() | set():
            return [safe_json_value(i) for i in v]
        case _:
            return v


def safe_json_dict(d: dict[str, Any]):
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
                    meta = cls._with_tool_file_meta(
                        message.meta,
                        tool_file_id=str(tool_file.id),
                    )

                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                        message=ToolInvokeMessage.TextMessage(text=url),
                        meta=meta,
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
                if not mimetype:
                    mimetype = "application/octet-stream"
                # get filename from meta
                filename = meta.get("filename", None)
                # if message is str, encode it to bytes

                if not isinstance(message.message, ToolInvokeMessage.BlobMessage):
                    raise ValueError("unexpected message type")

                if not isinstance(message.message.blob, bytes):
                    raise TypeError(f"Expected blob to be bytes, got {type(message.message.blob).__name__}")
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
                meta = cls._with_tool_file_meta(meta, tool_file_id=str(tool_file.id))

                # check if file is image
                if "image" in mimetype:
                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                        message=ToolInvokeMessage.TextMessage(text=url),
                        meta=meta,
                    )
                else:
                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.BINARY_LINK,
                        message=ToolInvokeMessage.TextMessage(text=url),
                        meta=meta,
                    )
            elif message.type == ToolInvokeMessage.MessageType.FILE:
                meta = message.meta or {}
                file = meta.get("file", None)
                if isinstance(file, File):
                    if file.transfer_method == FileTransferMethod.TOOL_FILE:
                        parsed_reference = parse_file_reference(file.reference)
                        if parsed_reference is None:
                            raise ValueError("tool file is missing reference")
                        url = cls.get_tool_file_url(
                            tool_file_id=parsed_reference.record_id,
                            extension=file.extension,
                        )
                        tool_file_meta = cls._with_tool_file_meta(meta, tool_file_id=parsed_reference.record_id)
                        if file.type == FileType.IMAGE:
                            yield ToolInvokeMessage(
                                type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                                message=ToolInvokeMessage.TextMessage(text=url),
                                meta=tool_file_meta,
                            )
                        else:
                            yield ToolInvokeMessage(
                                type=ToolInvokeMessage.MessageType.LINK,
                                message=ToolInvokeMessage.TextMessage(text=url),
                                meta=tool_file_meta,
                            )
                    else:
                        yield message

            elif message.type == ToolInvokeMessage.MessageType.JSON:
                if isinstance(message.message, ToolInvokeMessage.JsonMessage):
                    message.message.json_object = safe_json_value(message.message.json_object)
                yield message
            elif message.type in {
                ToolInvokeMessage.MessageType.IMAGE_LINK,
                ToolInvokeMessage.MessageType.BINARY_LINK,
            } and isinstance(message.message, ToolInvokeMessage.TextMessage):
                yield ToolInvokeMessage(
                    type=message.type,
                    message=message.message,
                    meta=cls._with_tool_file_meta(message.meta, url=message.message.text),
                )
            else:
                yield message

    @classmethod
    def get_tool_file_url(cls, tool_file_id: str, extension: str | None) -> str:
        return f"/files/tools/{tool_file_id}{extension or '.bin'}"

    @staticmethod
    def _with_tool_file_meta(
        meta: dict[str, Any] | None,
        *,
        tool_file_id: str | None = None,
        url: str | None = None,
    ) -> dict[str, Any]:
        normalized_meta = meta.copy() if meta is not None else {}
        resolved_tool_file_id = tool_file_id or ToolFileMessageTransformer._extract_tool_file_id(url)
        if resolved_tool_file_id and "tool_file_id" not in normalized_meta:
            normalized_meta["tool_file_id"] = resolved_tool_file_id
        return normalized_meta

    @staticmethod
    def _extract_tool_file_id(url: str | None) -> str | None:
        if not url:
            return None
        match = _TOOL_FILE_URL_PATTERN.search(url)
        if match is None:
            return None
        return match.group("tool_file_id")
