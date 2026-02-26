import urllib.parse

import httpx
from flask_restx import Resource
from pydantic import BaseModel, Field

import services
from controllers.common import helpers
from controllers.common.errors import (
    FileTooLargeError,
    RemoteFileUploadError,
    UnsupportedFileTypeError,
)
from controllers.console import console_ns
from core.helper import ssrf_proxy
from core.workflow.file import helpers as file_helpers
from extensions.ext_database import db
from fields.file_fields import FileWithSignedUrl, RemoteFileInfo
from libs.login import current_account_with_tenant, login_required
from services.file_service import FileService


class RemoteFileUploadPayload(BaseModel):
    url: str = Field(..., description="URL to fetch")


@console_ns.route("/remote-files/<path:url>")
class GetRemoteFileInfo(Resource):
    @login_required
    def get(self, url: str):
        decoded_url = urllib.parse.unquote(url)
        resp = ssrf_proxy.head(decoded_url)
        if resp.status_code != httpx.codes.OK:
            resp = ssrf_proxy.get(decoded_url, timeout=3)
        resp.raise_for_status()
        return RemoteFileInfo(
            file_type=resp.headers.get("Content-Type", "application/octet-stream"),
            file_length=int(resp.headers.get("Content-Length", 0)),
        ).model_dump(mode="json")


@console_ns.route("/remote-files/upload")
class RemoteFileUpload(Resource):
    @login_required
    def post(self):
        payload = RemoteFileUploadPayload.model_validate(console_ns.payload)
        url = payload.url

        # Try to fetch remote file metadata/content first
        try:
            resp = ssrf_proxy.head(url=url)
            if resp.status_code != httpx.codes.OK:
                resp = ssrf_proxy.get(url=url, timeout=3, follow_redirects=True)
            if resp.status_code != httpx.codes.OK:
                # Normalize into a user-friendly error message expected by tests
                raise RemoteFileUploadError(f"Failed to fetch file from {url}: {resp.text}")
        except httpx.RequestError as e:
            raise RemoteFileUploadError(f"Failed to fetch file from {url}: {str(e)}")

        file_info = helpers.guess_file_info_from_response(resp)

        # Enforce file size limit with 400 (Bad Request) per tests' expectation
        if not FileService.is_file_size_within_limit(extension=file_info.extension, file_size=file_info.size):
            raise FileTooLargeError()

        # Load content if needed
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

        # Success: return created resource with 201 status
        return (
            FileWithSignedUrl(
                id=upload_file.id,
                name=upload_file.name,
                size=upload_file.size,
                extension=upload_file.extension,
                url=file_helpers.get_signed_file_url(upload_file_id=upload_file.id),
                mime_type=upload_file.mime_type,
                created_by=upload_file.created_by,
                created_at=int(upload_file.created_at.timestamp()),
            ).model_dump(mode="json"),
            201,
        )
