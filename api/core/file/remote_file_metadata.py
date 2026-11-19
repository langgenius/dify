import contextlib
import mimetypes
import os
import platform
import urllib.parse
import warnings
from uuid import uuid4

import httpx

from libs.http_headers import content_disposition_filename, content_type_media_type

try:
    import magic
except ImportError:
    if platform.system() == "Windows":
        warnings.warn(
            "To use python-magic guess MIMETYPE, you need to run `pip install python-magic-bin`", stacklevel=2
        )
    elif platform.system() == "Darwin":
        warnings.warn("To use python-magic guess MIMETYPE, you need to run `brew install libmagic`", stacklevel=2)
    elif platform.system() == "Linux":
        warnings.warn(
            "To use python-magic guess MIMETYPE, you need to run `sudo apt-get install libmagic1`", stacklevel=2
        )
    else:
        warnings.warn("To use python-magic guess MIMETYPE, you need to install `libmagic`", stacklevel=2)
    magic = None  # type: ignore[assignment]

from pydantic import BaseModel


class FileInfo(BaseModel):
    filename: str
    extension: str
    mimetype: str
    size: int


class InvalidRemoteFileMetadataError(ValueError):
    pass


def guess_file_info_from_response(response: httpx.Response) -> FileInfo:
    url = str(response.url)
    # Prefer the response filename; download endpoints often have no file extension.
    parsed_url = urllib.parse.urlparse(url)
    url_path = parsed_url.path
    filename = content_disposition_filename(response.headers.get("Content-Disposition"))
    if not filename:
        filename = urllib.parse.unquote(os.path.basename(url_path))

    # If still no filename, generate a unique one
    if not filename:
        unique_name = str(uuid4())
        filename = f"{unique_name}"

    # Guess MIME type from filename first, then URL
    mimetype, _ = mimetypes.guess_type(filename)
    if mimetype is None:
        mimetype, _ = mimetypes.guess_type(url)
    if mimetype is None:
        # If guessing fails, use Content-Type from response headers
        mimetype = content_type_media_type(response.headers.get("Content-Type", "application/octet-stream"))

    # Use python-magic to guess MIME type if still unknown or generic
    if mimetype == "application/octet-stream" and magic is not None:
        with contextlib.suppress(magic.MagicException):
            mimetype = magic.from_buffer(response.content[:1024], mime=True)

    extension = os.path.splitext(filename)[1]

    # Ensure filename has an extension
    if not extension:
        extension = mimetypes.guess_extension(mimetype) or ".bin"
        filename = f"{filename}{extension}"

    try:
        size = int(response.headers.get("Content-Length", -1))
    except ValueError as error:
        raise InvalidRemoteFileMetadataError("The Content-Length header is invalid") from error

    return FileInfo(
        filename=filename,
        extension=extension,
        mimetype=mimetype,
        size=size,
    )
