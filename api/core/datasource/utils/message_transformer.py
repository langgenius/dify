import logging
from collections.abc import Generator
from mimetypes import guess_extension, guess_type

from core.datasource.entities.datasource_entities import DatasourceMessage
from core.file import File, FileTransferMethod, FileType
from core.tools.tool_file_manager import ToolFileManager
from models.tools import ToolFile

logger = logging.getLogger(__name__)


class DatasourceFileMessageTransformer:
    @classmethod
    def transform_datasource_invoke_messages(
        cls,
        messages: Generator[DatasourceMessage, None, None],
        user_id: str,
        tenant_id: str,
        conversation_id: str | None = None,
    ) -> Generator[DatasourceMessage, None, None]:
        """
        Transform datasource message and handle file download
        """
        for message in messages:
            if message.type in {DatasourceMessage.MessageType.TEXT, DatasourceMessage.MessageType.LINK}:
                yield message
            elif message.type == DatasourceMessage.MessageType.IMAGE and isinstance(
                message.message, DatasourceMessage.TextMessage
            ):
                # try to download image
                try:
                    assert isinstance(message.message, DatasourceMessage.TextMessage)
                    tool_file_manager = ToolFileManager()
                    tool_file: ToolFile | None = tool_file_manager.create_file_by_url(
                        user_id=user_id,
                        tenant_id=tenant_id,
                        file_url=message.message.text,
                        conversation_id=conversation_id,
                    )
                    if tool_file:
                        url = f"/files/datasources/{tool_file.id}{guess_extension(tool_file.mimetype) or '.png'}"

                        yield DatasourceMessage(
                            type=DatasourceMessage.MessageType.IMAGE_LINK,
                            message=DatasourceMessage.TextMessage(text=url),
                            meta=message.meta.copy() if message.meta is not None else {},
                        )
                except Exception as e:
                    yield DatasourceMessage(
                        type=DatasourceMessage.MessageType.TEXT,
                        message=DatasourceMessage.TextMessage(
                            text=f"Failed to download image: {message.message.text}: {e}"
                        ),
                        meta=message.meta.copy() if message.meta is not None else {},
                    )
            elif message.type == DatasourceMessage.MessageType.BLOB:
                # get mime type and save blob to storage
                meta = message.meta or {}
                # get filename from meta
                filename = meta.get("file_name", None)

                mimetype = meta.get("mime_type")
                if not mimetype:
                    mimetype = (guess_type(filename)[0] if filename else None) or "application/octet-stream"

                # if message is str, encode it to bytes

                if not isinstance(message.message, DatasourceMessage.BlobMessage):
                    raise ValueError("unexpected message type")

                # FIXME: should do a type check here.
                assert isinstance(message.message.blob, bytes)
                tool_file_manager = ToolFileManager()
                blob_tool_file: ToolFile | None = tool_file_manager.create_file_by_raw(
                    user_id=user_id,
                    tenant_id=tenant_id,
                    conversation_id=conversation_id,
                    file_binary=message.message.blob,
                    mimetype=mimetype,
                    filename=filename,
                )
                if blob_tool_file:
                    url = cls.get_datasource_file_url(
                        datasource_file_id=blob_tool_file.id, extension=guess_extension(blob_tool_file.mimetype)
                    )

                    # check if file is image
                    if "image" in mimetype:
                        yield DatasourceMessage(
                            type=DatasourceMessage.MessageType.IMAGE_LINK,
                            message=DatasourceMessage.TextMessage(text=url),
                            meta=meta.copy() if meta is not None else {},
                        )
                    else:
                        yield DatasourceMessage(
                            type=DatasourceMessage.MessageType.BINARY_LINK,
                            message=DatasourceMessage.TextMessage(text=url),
                            meta=meta.copy() if meta is not None else {},
                        )
            elif message.type == DatasourceMessage.MessageType.FILE:
                meta = message.meta or {}
                file: File | None = meta.get("file")
                if isinstance(file, File):
                    if file.transfer_method == FileTransferMethod.TOOL_FILE:
                        assert file.related_id is not None
                        url = cls.get_datasource_file_url(datasource_file_id=file.related_id, extension=file.extension)
                        if file.type == FileType.IMAGE:
                            yield DatasourceMessage(
                                type=DatasourceMessage.MessageType.IMAGE_LINK,
                                message=DatasourceMessage.TextMessage(text=url),
                                meta=meta.copy() if meta is not None else {},
                            )
                        else:
                            yield DatasourceMessage(
                                type=DatasourceMessage.MessageType.LINK,
                                message=DatasourceMessage.TextMessage(text=url),
                                meta=meta.copy() if meta is not None else {},
                            )
                    else:
                        yield message
            else:
                yield message

    @classmethod
    def get_datasource_file_url(cls, datasource_file_id: str, extension: str | None) -> str:
        return f"/files/datasources/{datasource_file_id}{extension or '.bin'}"
