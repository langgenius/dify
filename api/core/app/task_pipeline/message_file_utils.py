import os
from collections.abc import Mapping
from typing import TypedDict

from core.tools.signature import sign_tool_file
from graphon.file import FileTransferMethod
from graphon.file import helpers as file_helpers
from models.model import MessageFile, UploadFile
from models.tools import ToolFile

MAX_TOOL_FILE_EXTENSION_LENGTH = 10


def _normalize_basename(name: str | None) -> str | None:
    basename = os.path.basename((name or "").replace("\\", "/")).strip()
    if basename in {"", ".", ".."}:
        return None
    return basename


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


def prepare_file_dict(
    message_file: MessageFile,
    upload_files_map: Mapping[str, UploadFile],
    tool_files_map: Mapping[str, ToolFile] | None = None,
) -> MessageFileInfoDict:
    """
    Prepare file dictionary for message end stream response.

    :param message_file: MessageFile instance
    :param upload_files_map: Mapping from upload_file_id to UploadFile
    :param tool_files_map: Optional tenant-scoped mapping from ToolFile.id to ToolFile
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
    upload_file_id = message_file.upload_file_id or message_file.id

    match message_file.transfer_method:
        case FileTransferMethod.REMOTE_URL:
            url = message_file.url
            if message_file.url:
                filename = message_file.url.split("/")[-1].split("?")[0]
                if "." in filename:
                    extension = "." + filename.rsplit(".", 1)[1]
        case FileTransferMethod.LOCAL_FILE:
            if upload_file:
                url = file_helpers.get_signed_file_url(upload_file_id=str(upload_file.id))
                filename = upload_file.name
                mime_type = upload_file.mime_type or "application/octet-stream"
                size = upload_file.size or 0
                extension = f".{upload_file.extension}" if upload_file.extension else ""
            elif message_file.upload_file_id:
                url = file_helpers.get_signed_file_url(upload_file_id=str(message_file.upload_file_id))
        case FileTransferMethod.TOOL_FILE:
            parsed_tool_file_id: str | None = None
            if message_file.url:
                if message_file.url.startswith(("http://", "https://")):
                    url = message_file.url
                    filename = message_file.url.split("/")[-1].split("?")[0]
                    if "." in filename:
                        parsed_tool_file_id, ext = filename.rsplit(".", 1)
                        extension = f".{ext}"
                    else:
                        parsed_tool_file_id = filename
                else:
                    url_parts = message_file.url.split("/")
                    if url_parts:
                        file_part = url_parts[-1].split("?")[0]
                        if "." in file_part:
                            parsed_tool_file_id, ext = file_part.rsplit(".", 1)
                            extension = f".{ext}"
                            if len(extension) > MAX_TOOL_FILE_EXTENSION_LENGTH:
                                extension = ".bin"
                        else:
                            parsed_tool_file_id = file_part
                            extension = ".bin"
                        url = sign_tool_file(tool_file_id=parsed_tool_file_id, extension=extension)
                        filename = file_part
            if tool_files_map:
                lookup_id = message_file.upload_file_id or parsed_tool_file_id
                tool_file = tool_files_map.get(lookup_id) if lookup_id else None
                if tool_file is not None:
                    normalized_name = _normalize_basename(tool_file.name)
                    if normalized_name:
                        filename = normalized_name
                    mime_type = tool_file.mimetype or "application/octet-stream"
                    size = tool_file.size if isinstance(tool_file.size, int) and tool_file.size >= 0 else 0
                    upload_file_id = tool_file.id
        case FileTransferMethod.DATASOURCE_FILE:
            pass

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
        "upload_file_id": upload_file_id,
        "remote_url": remote_url,
    }
