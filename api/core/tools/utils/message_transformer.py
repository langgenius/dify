import logging
from collections.abc import Generator
from mimetypes import guess_extension
from typing import Optional

from core.file.file_obj import FileTransferMethod, FileType, FileVar
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool_file_manager import ToolFileManager

logger = logging.getLogger(__name__)

class ToolFileMessageTransformer:
    @classmethod
    def transform_tool_invoke_messages(cls, messages: Generator[ToolInvokeMessage, None, None],
                                       user_id: str,
                                       tenant_id: str,
                                       conversation_id: Optional[str] = None) -> Generator[ToolInvokeMessage, None, None]:
        """
        Transform tool message and handle file download
        """
        for message in messages:
            if message.type == ToolInvokeMessage.MessageType.TEXT:
                yield message
            elif message.type == ToolInvokeMessage.MessageType.LINK:
                yield message
            elif message.type == ToolInvokeMessage.MessageType.IMAGE:
                # try to download image
                try:
                    if not conversation_id:
                        raise 

                    assert isinstance(message.message, ToolInvokeMessage.TextMessage)

                    file = ToolFileManager.create_file_by_url(
                        user_id=user_id,
                        tenant_id=tenant_id,
                        file_url=message.message.text,
                        conversation_id=conversation_id,
                    )

                    url = f'/files/tools/{file.id}{guess_extension(file.mimetype) or ".png"}'

                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                        message=ToolInvokeMessage.TextMessage(text=url),
                        save_as=message.save_as,
                        meta=message.meta.copy() if message.meta is not None else {},
                    )
                except Exception as e:
                    logger.exception(e)
                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.TEXT,
                        message=ToolInvokeMessage.TextMessage(
                            text=f"Failed to download image: {message.message}, you can try to download it yourself."
                        ),
                        meta=message.meta.copy() if message.meta is not None else {},
                        save_as=message.save_as,
                    )
            elif message.type == ToolInvokeMessage.MessageType.BLOB:
                # get mime type and save blob to storage
                assert message.meta

                mimetype = message.meta.get('mime_type', 'octet/stream')
                # if message is str, encode it to bytes

                if not isinstance(message.message, ToolInvokeMessage.BlobMessage):
                    raise ValueError("unexpected message type")

                file = ToolFileManager.create_file_by_raw(
                    user_id=user_id, tenant_id=tenant_id,
                    conversation_id=conversation_id,
                    file_binary=message.message.blob,
                    mimetype=mimetype
                )

                extension = guess_extension(file.mimetype) or ".bin"
                url = cls.get_tool_file_url(file.id, extension)

                # check if file is image
                if 'image' in mimetype:
                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                        message=ToolInvokeMessage.TextMessage(text=url),
                        save_as=message.save_as,
                        meta=message.meta.copy() if message.meta is not None else {},
                    )
                else:
                    yield ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.LINK,
                        message=ToolInvokeMessage.TextMessage(text=url),
                        save_as=message.save_as,
                        meta=message.meta.copy() if message.meta is not None else {},
                    )
            elif message.type == ToolInvokeMessage.MessageType.FILE_VAR:
                assert message.meta

                file_var: FileVar | None = message.meta.get('file_var')
                if file_var:
                    if file_var.transfer_method == FileTransferMethod.TOOL_FILE:
                        assert file_var.related_id and file_var.extension

                        url = cls.get_tool_file_url(file_var.related_id, file_var.extension)
                        if file_var.type == FileType.IMAGE:
                            yield ToolInvokeMessage(
                                type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                                message=ToolInvokeMessage.TextMessage(text=url),
                                save_as=message.save_as,
                                meta=message.meta.copy() if message.meta is not None else {},
                            )
                        else:
                            yield ToolInvokeMessage(
                                type=ToolInvokeMessage.MessageType.LINK,
                                message=ToolInvokeMessage.TextMessage(text=url),
                                save_as=message.save_as,
                                meta=message.meta.copy() if message.meta is not None else {},
                            )
            else:
                yield message

    @classmethod
    def get_tool_file_url(cls, tool_file_id: str, extension: str) -> str:
        return f'/files/tools/{tool_file_id}{extension or ".bin"}'
