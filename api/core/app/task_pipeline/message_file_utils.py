from typing import TypedDict

from core.tools.signature import sign_tool_file
from dify_graph.file import helpers as file_helpers
from dify_graph.file.enums import FileTransferMethod
from models.model import MessageFile, UploadFile

MAX_TOOL_FILE_EXTENSION_LENGTH = 10


class MessageFileInfoDict(TypedDict):
    related_id: str
    extension: str
    filename: str
    size: int
    mime_type: str
    transfer_method: str
    type: str
    url: str
    upload_file_id: str
    remote_url: str | None


def prepare_file_dict(message_file: MessageFile, upload_files_map: dict[str, UploadFile]) -> MessageFileInfoDict:
    """
    Prepare file dictionary for message end stream response.

    :param message_file: MessageFile instance
    :param upload_files_map: Dictionary mapping upload_file_id to UploadFile
    :return: Dictionary containing file information
    """
    upload_file = None
    if message_file.transfer_method == FileTransferMethod.LOCAL_FILE and message_file.upload_file_id:
        upload_file = upload_files_map.get(message_file.upload_file_id)

    url = None
    filename = "file"
    mime_type = "application/octet-stream"
    size = 0
    extension = ""

    if message_file.transfer_method == FileTransferMethod.REMOTE_URL:
        url = message_file.url
        if message_file.url:
            filename = message_file.url.split("/")[-1].split("?")[0]
            if "." in filename:
                extension = "." + filename.rsplit(".", 1)[1]
    elif message_file.transfer_method == FileTransferMethod.LOCAL_FILE:
        if upload_file:
            url = file_helpers.get_signed_file_url(upload_file_id=str(upload_file.id))
            filename = upload_file.name
            mime_type = upload_file.mime_type or "application/octet-stream"
            size = upload_file.size or 0
            extension = f".{upload_file.extension}" if upload_file.extension else ""
        elif message_file.upload_file_id:
            url = file_helpers.get_signed_file_url(upload_file_id=str(message_file.upload_file_id))
    elif message_file.transfer_method == FileTransferMethod.TOOL_FILE and message_file.url:
        if message_file.url.startswith(("http://", "https://")):
            url = message_file.url
            filename = message_file.url.split("/")[-1].split("?")[0]
            if "." in filename:
                extension = "." + filename.rsplit(".", 1)[1]
        else:
            url_parts = message_file.url.split("/")
            if url_parts:
                file_part = url_parts[-1].split("?")[0]
                if "." in file_part:
                    tool_file_id, ext = file_part.rsplit(".", 1)
                    extension = f".{ext}"
                    if len(extension) > MAX_TOOL_FILE_EXTENSION_LENGTH:
                        extension = ".bin"
                else:
                    tool_file_id = file_part
                    extension = ".bin"
                url = sign_tool_file(tool_file_id=tool_file_id, extension=extension)
                filename = file_part

    transfer_method_value = message_file.transfer_method.value
    remote_url = message_file.url if message_file.transfer_method == FileTransferMethod.REMOTE_URL else ""
    return {
        "related_id": message_file.id,
        "extension": extension,
        "filename": filename,
        "size": size,
        "mime_type": mime_type,
        "transfer_method": transfer_method_value,
        "type": message_file.type,
        "url": url or "",
        "upload_file_id": message_file.upload_file_id or message_file.id,
        "remote_url": remote_url,
    }
