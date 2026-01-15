import urllib.parse

import httpx
from pydantic import BaseModel, Field, HttpUrl

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
from fields.file_fields import FileWithSignedUrl, RemoteFileInfo
from services.file_service import FileService

from ..common.schema import register_schema_models
from . import web_ns
from .wraps import WebApiResource


class RemoteFileUploadPayload(BaseModel):
    url: HttpUrl = Field(description="Remote file URL")


register_schema_models(web_ns, RemoteFileUploadPayload, RemoteFileInfo, FileWithSignedUrl)


@web_ns.route("/remote-files/<path:url>")
class RemoteFileInfoApi(WebApiResource):
    @web_ns.doc("get_remote_file_info")
    @web_ns.doc(description="Get information about a remote file")
    @web_ns.doc(
        responses={
            200: "Remote file information retrieved successfully",
            400: "Bad request - invalid URL",
            404: "Remote file not found",
            500: "Failed to fetch remote file",
        }
    )
    @web_ns.response(200, "Remote file info", web_ns.models[RemoteFileInfo.__name__])
    def get(self, app_model, end_user, url):
        """Get information about a remote file.

        Retrieves basic information about a file located at a remote URL,
        including content type and content length.

        Args:
            app_model: The associated application model
            end_user: The end user making the request
            url: URL-encoded path to the remote file

        Returns:
            dict: Remote file information including type and length

        Raises:
            HTTPException: If the remote file cannot be accessed
        """
        decoded_url = urllib.parse.unquote(url)
        resp = ssrf_proxy.head(decoded_url)
        if resp.status_code != httpx.codes.OK:
            # failed back to get method
            resp = ssrf_proxy.get(decoded_url, timeout=3)
        resp.raise_for_status()
        info = RemoteFileInfo(
            file_type=resp.headers.get("Content-Type", "application/octet-stream"),
            file_length=int(resp.headers.get("Content-Length", -1)),
        )
        return info.model_dump(mode="json")


@web_ns.route("/remote-files/upload")
class RemoteFileUploadApi(WebApiResource):
    @web_ns.doc("upload_remote_file")
    @web_ns.doc(description="Upload a file from a remote URL")
    @web_ns.doc(
        responses={
            201: "Remote file uploaded successfully",
            400: "Bad request - invalid URL or parameters",
            413: "File too large",
            415: "Unsupported file type",
            500: "Failed to fetch remote file",
        }
    )
    @web_ns.response(201, "Remote file uploaded", web_ns.models[FileWithSignedUrl.__name__])
    def post(self, app_model, end_user):
        """Upload a file from a remote URL.

        Downloads a file from the provided remote URL and uploads it
        to the platform storage for use in web applications.

        Args:
            app_model: The associated application model
            end_user: The end user making the request

        JSON Parameters:
            url: The remote URL to download the file from (required)

        Returns:
            dict: File information including ID, signed URL, and metadata
            int: HTTP status code 201 for success

        Raises:
            RemoteFileUploadError: Failed to fetch file from remote URL
            FileTooLargeError: File exceeds size limit
            UnsupportedFileTypeError: File type not supported
        """
        payload = RemoteFileUploadPayload.model_validate(web_ns.payload or {})
        url = str(payload.url)

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
            upload_file = FileService(db.engine).upload_file(
                filename=file_info.filename,
                content=content,
                mimetype=file_info.mimetype,
                user=end_user,
                source_url=url,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError

        payload1 = FileWithSignedUrl(
            id=upload_file.id,
            name=upload_file.name,
            size=upload_file.size,
            extension=upload_file.extension,
            url=file_helpers.get_signed_file_url(upload_file_id=upload_file.id),
            mime_type=upload_file.mime_type,
            created_by=upload_file.created_by,
            created_at=int(upload_file.created_at.timestamp()),
        )
        return payload1.model_dump(mode="json"), 201
