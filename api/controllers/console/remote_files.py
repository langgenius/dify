import httpx
from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

import services
from controllers.common import helpers
from controllers.common.errors import (
    FileTooLargeError,
    RemoteFileUploadError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import with_current_user
from core.file import remote_fetcher
from extensions.ext_database import db
from fields.file_fields import FileWithSignedUrl, RemoteFileInfo
from graphon.file import helpers as file_helpers
from libs.login import login_required
from models import Account
from services.file_service import FileService


class RemoteFileUploadPayload(BaseModel):
    url: str = Field(..., description="URL to fetch")


register_schema_models(console_ns, RemoteFileUploadPayload)
register_response_schema_models(console_ns, FileWithSignedUrl, RemoteFileInfo)


@console_ns.route("/remote-files/<path:url>")
class GetRemoteFileInfo(Resource):
    @console_ns.response(200, "Success", console_ns.models[RemoteFileInfo.__name__])
    @login_required
    def get(self, url: str):
        decoded_url = helpers.decode_remote_url(url, request.query_string)
        resp = remote_fetcher.make_request("HEAD", decoded_url)
        if resp.status_code != httpx.codes.OK:
            resp = remote_fetcher.make_request("GET", decoded_url, timeout=3)
        resp.raise_for_status()
        return RemoteFileInfo(
            file_type=resp.headers.get("Content-Type", "application/octet-stream"),
            file_length=int(resp.headers.get("Content-Length", 0)),
        ).model_dump(mode="json")


@console_ns.route("/remote-files/upload")
class RemoteFileUpload(Resource):
    @console_ns.expect(console_ns.models[RemoteFileUploadPayload.__name__])
    @console_ns.response(201, "File uploaded successfully", console_ns.models[FileWithSignedUrl.__name__])
    @login_required
    @with_current_user
    def post(self, current_user: Account):
        payload = RemoteFileUploadPayload.model_validate(console_ns.payload)
        url = payload.url

        # Try to fetch remote file metadata/content first
        try:
            resp = remote_fetcher.make_request("HEAD", url=url)
            if resp.status_code != httpx.codes.OK:
                resp = remote_fetcher.make_request("GET", url=url, timeout=3, follow_redirects=True)
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
        content = resp.content if resp.request.method == "GET" else remote_fetcher.make_request("GET", url).content

        try:
            upload_file = FileService(db.engine).upload_file(
                filename=file_info.filename,
                content=content,
                mimetype=file_info.mimetype,
                user=current_user,
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
