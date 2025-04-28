import logging
from collections.abc import Generator
from mimetypes import guess_extension
from typing import Optional

from core.datasource.datasource_file_manager import DatasourceFileManager
from core.datasource.entities.datasource_entities import DatasourceInvokeMessage
from core.file import File, FileTransferMethod, FileType

logger = logging.getLogger(__name__)


class DatasourceFileMessageTransformer:
    @classmethod
    def transform_datasource_invoke_messages(
        cls,
        messages: Generator[DatasourceInvokeMessage, None, None],
        user_id: str,
        tenant_id: str,
        conversation_id: Optional[str] = None,
    ) -> Generator[DatasourceInvokeMessage, None, None]:
        """
        Transform datasource message and handle file download
        """
        for message in messages:
            if message.type in {DatasourceInvokeMessage.MessageType.TEXT, DatasourceInvokeMessage.MessageType.LINK}:
                yield message
            elif message.type == DatasourceInvokeMessage.MessageType.IMAGE and isinstance(
                message.message, DatasourceInvokeMessage.TextMessage
            ):
                # try to download image
                try:
                    assert isinstance(message.message, DatasourceInvokeMessage.TextMessage)

                    file = DatasourceFileManager.create_file_by_url(
                        user_id=user_id,
                        tenant_id=tenant_id,
                        file_url=message.message.text,
                        conversation_id=conversation_id,
                    )

                    url = f"/files/datasources/{file.id}{guess_extension(file.mimetype) or '.png'}"

                    yield DatasourceInvokeMessage(
                        type=DatasourceInvokeMessage.MessageType.IMAGE_LINK,
                        message=DatasourceInvokeMessage.TextMessage(text=url),
                        meta=message.meta.copy() if message.meta is not None else {},
                    )
                except Exception as e:
                    yield DatasourceInvokeMessage(
                        type=DatasourceInvokeMessage.MessageType.TEXT,
                        message=DatasourceInvokeMessage.TextMessage(
                            text=f"Failed to download image: {message.message.text}: {e}"
                        ),
                        meta=message.meta.copy() if message.meta is not None else {},
                    )
            elif message.type == DatasourceInvokeMessage.MessageType.BLOB:
                # get mime type and save blob to storage
                meta = message.meta or {}

                mimetype = meta.get("mime_type", "application/octet-stream")
                # get filename from meta
                filename = meta.get("file_name", None)
                # if message is str, encode it to bytes

                if not isinstance(message.message, DatasourceInvokeMessage.BlobMessage):
                    raise ValueError("unexpected message type")

                # FIXME: should do a type check here.
                assert isinstance(message.message.blob, bytes)
                file = DatasourceFileManager.create_file_by_raw(
                    user_id=user_id,
                    tenant_id=tenant_id,
                    conversation_id=conversation_id,
                    file_binary=message.message.blob,
                    mimetype=mimetype,
                    filename=filename,
                )

                url = cls.get_datasource_file_url(datasource_file_id=file.id, extension=guess_extension(file.mimetype))

                # check if file is image
                if "image" in mimetype:
                    yield DatasourceInvokeMessage(
                        type=DatasourceInvokeMessage.MessageType.IMAGE_LINK,
                        message=DatasourceInvokeMessage.TextMessage(text=url),
                        meta=meta.copy() if meta is not None else {},
                    )
                else:
                    yield DatasourceInvokeMessage(
                        type=DatasourceInvokeMessage.MessageType.BINARY_LINK,
                        message=DatasourceInvokeMessage.TextMessage(text=url),
                        meta=meta.copy() if meta is not None else {},
                    )
            elif message.type == DatasourceInvokeMessage.MessageType.FILE:
                meta = message.meta or {}
                file = meta.get("file", None)
                if isinstance(file, File):
                    if file.transfer_method == FileTransferMethod.TOOL_FILE:
                        assert file.related_id is not None
                        url = cls.get_tool_file_url(tool_file_id=file.related_id, extension=file.extension)
                        if file.type == FileType.IMAGE:
                            yield DatasourceInvokeMessage(
                                type=DatasourceInvokeMessage.MessageType.IMAGE_LINK,
                                message=DatasourceInvokeMessage.TextMessage(text=url),
                                meta=meta.copy() if meta is not None else {},
                            )
                        else:
                            yield DatasourceInvokeMessage(
                                type=DatasourceInvokeMessage.MessageType.LINK,
                                message=DatasourceInvokeMessage.TextMessage(text=url),
                                meta=meta.copy() if meta is not None else {},
                            )
                    else:
                        yield message
            else:
                yield message

    @classmethod
    def get_datasource_file_url(cls, datasource_file_id: str, extension: Optional[str]) -> str:
        return f"/files/datasources/{datasource_file_id}{extension or '.bin'}"
