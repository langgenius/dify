import mimetypes
import os
import re
import urllib.parse
from uuid import uuid4

from flask_login import current_user
from flask_restful import marshal_with, reqparse

from controllers.web.wraps import WebApiResource
from core.helper import ssrf_proxy
from fields.file_fields import remote_file_info_fields
from services.file_service import FileService


class RemoteFileInfoApi(WebApiResource):
    @marshal_with(remote_file_info_fields)
    def get(self, url):
        decoded_url = urllib.parse.unquote(url)
        try:
            response = ssrf_proxy.head(decoded_url)
            return {
                "file_type": response.headers.get("Content-Type", "application/octet-stream"),
                "file_length": int(response.headers.get("Content-Length", -1)),
            }
        except Exception as e:
            return {"error": str(e)}, 400


class RemoteFileUploadApi(WebApiResource):
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("url", type=str, required=True, help="URL is required")
        args = parser.parse_args()

        url = args["url"]

        try:
            response = ssrf_proxy.get(url)
            response.raise_for_status()
            content = response.content
        except Exception as e:
            return {"error": str(e)}, 400

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

        # Ensure filename has an extension
        if not os.path.splitext(filename)[1]:
            extension = mimetypes.guess_extension(mimetype) or ".bin"
            filename = f"{filename}{extension}"

        try:
            upload_file = FileService.upload_file(
                filename=filename,
                content=content,
                mimetype=mimetype,
                user=current_user,
            )
        except Exception as e:
            return {"error": str(e)}, 400

        return upload_file, 201
