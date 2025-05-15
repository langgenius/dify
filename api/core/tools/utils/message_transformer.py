import logging
from collections.abc import Generator
from mimetypes import guess_extension
from typing import Optional

from core.file import File, FileTransferMethod, FileType
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool_file_manager import ToolFileManager

logger = logging.getLogger(__name__)


class ToolFileMessageTransformer:
    @classmethod
    def transform_tool_invoke_messages(
        cls,
        messages: Generator[ToolInvokeMessage, None, None],
        user_id: str,
        tenant_id: str,
        conversation_id: Optional[str] = None,
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
                    file = tool_file_manager.create_file_by_url(
                        user_id=user_id,
                        tenant_id=tenant_id,
                        file_url=message.message.text,
                        conversation_id=conversation_id,
                    )

                    url = f"/files/tools/{file.id}{guess_extension(file.mimetype) or '.png'}"

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

                # FIXME: should do a type check here.
                assert isinstance(message.message.blob, bytes)
                tool_file_manager = ToolFileManager()
                file = tool_file_manager.create_file_by_raw(
                    user_id=user_id,
                    tenant_id=tenant_id,
                    conversation_id=conversation_id,
                    file_binary=message.message.blob,
                    mimetype=mimetype,
                    filename=filename,
                )

                url = cls.get_tool_file_url(tool_file_id=file.id, extension=guess_extension(file.mimetype))

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
            else:
                yield message

    @classmethod
    def get_tool_file_url(cls, tool_file_id: str, extension: Optional[str]) -> str:
        return f"/files/tools/{tool_file_id}{extension or '.bin'}"
