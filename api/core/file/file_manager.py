import base64

from configs import dify_config
from core.model_runtime.entities.message_entities import ImagePromptMessageContent
from extensions.ext_database import db
from extensions.ext_storage import storage
from models import UploadFile

from . import helpers
from .enums import FileAttribute
from .models import File, FileTransferMethod, FileType
from .tool_file_parser import ToolFileParser


def get_attr(*, file: "File", attr: "FileAttribute"):
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


def to_prompt_message_content(file: "File", /):
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
    if file.type != FileType.IMAGE:
        raise ValueError("Only image file can convert to prompt message content")

    url_or_b64_data = _get_url_or_b64_data(file=file)
    if url_or_b64_data is None:
        raise ValueError("Missing file data")

    # decide the detail of image prompt message content
    if file._extra_config and file._extra_config.image_config and file._extra_config.image_config.detail:
        detail = file._extra_config.image_config.detail
    else:
        detail = ImagePromptMessageContent.DETAIL.LOW

    return ImagePromptMessageContent(data=url_or_b64_data, detail=detail)


def download(*, upload_file_id: str, tenant_id: str):
    upload_file = (
        db.session.query(UploadFile).filter(UploadFile.id == upload_file_id, UploadFile.tenant_id == tenant_id).first()
    )

    if not upload_file:
        raise ValueError("upload file not found")

    return _download(upload_file.key)


def _download(path: str, /):
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


def _get_base64(*, upload_file_id: str, tenant_id: str) -> str | None:
    upload_file = (
        db.session.query(UploadFile).filter(UploadFile.id == upload_file_id, UploadFile.tenant_id == tenant_id).first()
    )

    if not upload_file:
        return None

    data = _download(upload_file.key)
    if data is None:
        return None

    encoded_string = base64.b64encode(data).decode("utf-8")
    return f"data:{upload_file.mime_type};base64,{encoded_string}"


def _get_url_or_b64_data(file: "File"):
    if file.type == FileType.IMAGE:
        if file.transfer_method == FileTransferMethod.REMOTE_URL:
            return file.remote_url
        elif file.transfer_method == FileTransferMethod.LOCAL_FILE:
            if file.related_id is None:
                raise ValueError("Missing file related_id")

            if dify_config.MULTIMODAL_SEND_IMAGE_FORMAT == "url":
                return helpers.get_signed_image_url(upload_file_id=file.related_id)
            return _get_base64(upload_file_id=file.related_id, tenant_id=file.tenant_id)
        elif file.transfer_method == FileTransferMethod.TOOL_FILE:
            # add sign url
            if file.related_id is None or file.extension is None:
                raise ValueError("Missing file related_id or extension")
            return ToolFileParser.get_tool_file_manager().sign_file(
                tool_file_id=file.related_id, extension=file.extension
            )
