import contextlib
import mimetypes
import os
import platform
import re
import urllib.parse
import warnings
from uuid import uuid4

import httpx

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


def guess_file_info_from_response(response: httpx.Response):
    url = str(response.url)
    # Try to extract filename from URL
    parsed_url = urllib.parse.urlparse(url)
    url_path = parsed_url.path
    filename = os.path.basename(url_path)

    # If filename couldn't be extracted, use Content-Disposition header
    if not filename:
        content_disposition = response.headers.get("Content-Disposition")
        if content_disposition:
            filename_match = re.search(r'filename="?(.+)"?', content_disposition)
            if filename_match:
                filename = filename_match.group(1)

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
        mimetype = response.headers.get("Content-Type", "application/octet-stream")

    # Use python-magic to guess MIME type if still unknown or generic
    if mimetype == "application/octet-stream" and magic is not None:
        with contextlib.suppress(magic.MagicException):
            mimetype = magic.from_buffer(response.content[:1024], mime=True)

    extension = os.path.splitext(filename)[1]

    # Ensure filename has an extension
    if not extension:
        extension = mimetypes.guess_extension(mimetype) or ".bin"
        filename = f"{filename}{extension}"

    return FileInfo(
        filename=filename,
        extension=extension,
        mimetype=mimetype,
        size=int(response.headers.get("Content-Length", -1)),
    )
