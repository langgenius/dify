import urllib.parse

import httpx
from flask_restx import Resource, marshal_with, reqparse

import services
from controllers.common import helpers
from controllers.common.errors import (
    FileTooLargeError,
    RemoteFileUploadError,
    UnsupportedFileTypeError,
)
from core.file import helpers as file_helpers
from core.helper import ssrf_proxy
from extensions.ext_database import db
from fields.file_fields import file_fields_with_signed_url, remote_file_info_fields
from libs.login import current_account_with_tenant
from services.file_service import FileService

from . import console_ns


@console_ns.route("/remote-files/<path:url>")
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


@console_ns.route("/remote-files/upload")
class RemoteFileUploadApi(Resource):
    @marshal_with(file_fields_with_signed_url)
    def post(self):
        parser = reqparse.RequestParser().add_argument("url", type=str, required=True, help="URL is required")
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
            user, _ = current_account_with_tenant()
            upload_file = FileService(db.engine).upload_file(
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
