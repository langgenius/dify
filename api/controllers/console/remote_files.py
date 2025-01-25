import urllib.parse
from typing import cast

import httpx
from flask_login import current_user  # type: ignore
from flask_restful import Resource, marshal_with, reqparse  # type: ignore

import services
from controllers.common import helpers
from controllers.common.errors import RemoteFileUploadError
from core.file import helpers as file_helpers
from core.helper import ssrf_proxy
from fields.file_fields import file_fields_with_signed_url, remote_file_info_fields
from models.account import Account
from services.file_service import FileService

from .error import (
    FileTooLargeError,
    UnsupportedFileTypeError,
)


class RemoteFileInfoApi(Resource):
    @marshal_with(remote_file_info_fields)
    def get(self, url):
        decoded_url = urllib.parse.unquote(url)
        resp = ssrf_proxy.head(decoded_url)
        if resp.status_code != httpx.codes.OK:
            # failed back to get method
            resp = ssrf_proxy.get(decoded_url, timeout=3)
        resp.raise_for_status()
        return {
            "file_type": resp.headers.get("Content-Type", "application/octet-stream"),
            "file_length": int(resp.headers.get("Content-Length", 0)),
        }


class RemoteFileUploadApi(Resource):
    @marshal_with(file_fields_with_signed_url)
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("url", type=str, required=True, help="URL is required")
        args = parser.parse_args()

        url = args["url"]

        try:
            resp = ssrf_proxy.head(url=url)
            if resp.status_code != httpx.codes.OK:
                resp = ssrf_proxy.get(url=url, timeout=3, follow_redirects=True)
            if resp.status_code != httpx.codes.OK:
                raise RemoteFileUploadError(f"Failed to fetch file from {url}: {resp.text}")
        except httpx.RequestError as e:
            raise RemoteFileUploadError(f"Failed to fetch file from {url}: {str(e)}")

        file_info = helpers.guess_file_info_from_response(resp)

        if not FileService.is_file_size_within_limit(extension=file_info.extension, file_size=file_info.size):
            raise FileTooLargeError

        content = resp.content if resp.request.method == "GET" else ssrf_proxy.get(url).content

        try:
            user = cast(Account, current_user)
            upload_file = FileService.upload_file(
                filename=file_info.filename,
                content=content,
                mimetype=file_info.mimetype,
                user=user,
                source_url=url,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return {
            "id": upload_file.id,
            "name": upload_file.name,
            "size": upload_file.size,
            "extension": upload_file.extension,
            "url": file_helpers.get_signed_file_url(upload_file_id=upload_file.id),
            "mime_type": upload_file.mime_type,
            "created_by": upload_file.created_by,
            "created_at": upload_file.created_at,
        }, 201
