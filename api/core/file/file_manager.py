import base64

from configs import dify_config
from core.file import file_repository
from core.helper import ssrf_proxy
from core.model_runtime.entities import AudioPromptMessageContent, ImagePromptMessageContent
from extensions.ext_database import db
from extensions.ext_storage import storage

from . import helpers
from .enums import FileAttribute
from .models import File, FileTransferMethod, FileType
from .tool_file_parser import ToolFileParser


def get_attr(*, file: File, attr: FileAttribute):
    match attr:
        case FileAttribute.TYPE:
            return file.type.value
        case FileAttribute.SIZE:
            return file.size
        case FileAttribute.NAME:
            return file.filename
        case FileAttribute.MIME_TYPE:
            return file.mime_type
        case FileAttribute.TRANSFER_METHOD:
            return file.transfer_method.value
        case FileAttribute.URL:
            return file.remote_url
        case FileAttribute.EXTENSION:
            return file.extension
        case _:
            raise ValueError(f"Invalid file attribute: {attr}")


def to_prompt_message_content(f: File, /):
    """
    Convert a File object to an ImagePromptMessageContent object.

    This function takes a File object and converts it to an ImagePromptMessageContent
    object, which can be used as a prompt for image-based AI models.

    Args:
        file (File): The File object to convert. Must be of type FileType.IMAGE.

    Returns:
        ImagePromptMessageContent: An object containing the image data and detail level.

    Raises:
        ValueError: If the file is not an image or if the file data is missing.

    Note:
        The detail level of the image prompt is determined by the file's extra_config.
        If not specified, it defaults to ImagePromptMessageContent.DETAIL.LOW.
    """
    match f.type:
        case FileType.IMAGE:
            if dify_config.MULTIMODAL_SEND_IMAGE_FORMAT == "url":
                data = _to_url(f)
            else:
                data = _to_base64_data_string(f)

            if f._extra_config and f._extra_config.image_config and f._extra_config.image_config.detail:
                detail = f._extra_config.image_config.detail
            else:
                detail = ImagePromptMessageContent.DETAIL.LOW

            return ImagePromptMessageContent(data=data, detail=detail)
        case FileType.AUDIO:
            encoded_string = _file_to_encoded_string(f)
            if f.extension is None:
                raise ValueError("Missing file extension")
            return AudioPromptMessageContent(data=encoded_string, format=f.extension.lstrip("."))
        case _:
            raise ValueError(f"file type {f.type} is not supported")


def download(f: File, /):
    upload_file = file_repository.get_upload_file(session=db.session(), file=f)
    return _download_file_content(upload_file.key)


def _download_file_content(path: str, /):
    """
    Download and return the contents of a file as bytes.

    This function loads the file from storage and ensures it's in bytes format.

    Args:
        path (str): The path to the file in storage.

    Returns:
        bytes: The contents of the file as a bytes object.

    Raises:
        ValueError: If the loaded file is not a bytes object.
    """
    data = storage.load(path, stream=False)
    if not isinstance(data, bytes):
        raise ValueError(f"file {path} is not a bytes object")
    return data


def _get_encoded_string(f: File, /):
    match f.transfer_method:
        case FileTransferMethod.REMOTE_URL:
            response = ssrf_proxy.get(f.remote_url)
            response.raise_for_status()
            content = response.content
            encoded_string = base64.b64encode(content).decode("utf-8")
            return encoded_string
        case FileTransferMethod.LOCAL_FILE:
            upload_file = file_repository.get_upload_file(session=db.session(), file=f)
            data = _download_file_content(upload_file.key)
            encoded_string = base64.b64encode(data).decode("utf-8")
            return encoded_string
        case FileTransferMethod.TOOL_FILE:
            tool_file = file_repository.get_tool_file(session=db.session(), file=f)
            data = _download_file_content(tool_file.file_key)
            encoded_string = base64.b64encode(data).decode("utf-8")
            return encoded_string
        case _:
            raise ValueError(f"Unsupported transfer method: {f.transfer_method}")


def _to_base64_data_string(f: File, /):
    encoded_string = _get_encoded_string(f)
    return f"data:{f.mime_type};base64,{encoded_string}"


def _file_to_encoded_string(f: File, /):
    match f.type:
        case FileType.IMAGE:
            return _to_base64_data_string(f)
        case FileType.AUDIO:
            return _get_encoded_string(f)
        case _:
            raise ValueError(f"file type {f.type} is not supported")


def _to_url(f: File, /):
    if f.transfer_method == FileTransferMethod.REMOTE_URL:
        if f.remote_url is None:
            raise ValueError("Missing file remote_url")
        return f.remote_url
    elif f.transfer_method == FileTransferMethod.LOCAL_FILE:
        if f.related_id is None:
            raise ValueError("Missing file related_id")
        return helpers.get_signed_file_url(upload_file_id=f.related_id)
    elif f.transfer_method == FileTransferMethod.TOOL_FILE:
        # add sign url
        if f.related_id is None or f.extension is None:
            raise ValueError("Missing file related_id or extension")
        return ToolFileParser.get_tool_file_manager().sign_file(tool_file_id=f.related_id, extension=f.extension)
    else:
        raise ValueError(f"Unsupported transfer method: {f.transfer_method}")
