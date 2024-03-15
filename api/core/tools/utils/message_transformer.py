import logging
from mimetypes import guess_extension

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool_file_manager import ToolFileManager

logger = logging.getLogger(__name__)

class ToolFileMessageTransformer:
    @staticmethod
    def transform_tool_invoke_messages(messages: list[ToolInvokeMessage],
                                       user_id: str,
                                       tenant_id: str,
                                       conversation_id: str) -> list[ToolInvokeMessage]:
        """
        Transform tool message and handle file download
        """
        result = []

        for message in messages:
            if message.type == ToolInvokeMessage.MessageType.TEXT:
                result.append(message)
            elif message.type == ToolInvokeMessage.MessageType.LINK:
                result.append(message)
            elif message.type == ToolInvokeMessage.MessageType.IMAGE:
                # try to download image
                try:
                    file = ToolFileManager.create_file_by_url(
                        user_id=user_id, 
                        tenant_id=tenant_id,
                        conversation_id=conversation_id,
                        file_url=message.message
                    )
                    
                    url = f'/files/tools/{file.id}{guess_extension(file.mimetype) or ".png"}'

                    result.append(ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                        message=url,
                        save_as=message.save_as,
                        meta=message.meta.copy() if message.meta is not None else {},
                    ))
                except Exception as e:
                    logger.exception(e)
                    result.append(ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.TEXT,
                        message=f"Failed to download image: {message.message}, you can try to download it yourself.",
                        meta=message.meta.copy() if message.meta is not None else {},
                        save_as=message.save_as,
                    ))
            elif message.type == ToolInvokeMessage.MessageType.BLOB:
                # get mime type and save blob to storage
                mimetype = message.meta.get('mime_type', 'octet/stream')
                # if message is str, encode it to bytes
                if isinstance(message.message, str):
                    message.message = message.message.encode('utf-8')
                
                file = ToolFileManager.create_file_by_raw(
                    user_id=user_id, tenant_id=tenant_id,
                    conversation_id=conversation_id,
                    file_binary=message.message,
                    mimetype=mimetype
                )
                                                            
                url = f'/files/tools/{file.id}{guess_extension(file.mimetype) or ".bin"}'

                # check if file is image
                if 'image' in mimetype:
                    result.append(ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                        message=url,
                        save_as=message.save_as,
                        meta=message.meta.copy() if message.meta is not None else {},
                    ))
                else:
                    result.append(ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.LINK,
                        message=url,
                        save_as=message.save_as,
                        meta=message.meta.copy() if message.meta is not None else {},
                    ))
            else:
                result.append(message)

        return result