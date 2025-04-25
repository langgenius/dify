import httpx
from flask import request
from flask_restful import Resource, marshal_with, reqparse  # type: ignore

import services
from controllers.common import helpers
from controllers.common.errors import FilenameNotExistsError, RemoteFileUploadError
from controllers.service_api import api
from controllers.service_api.app.error import (
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.file import helpers as file_helpers
from core.helper import ssrf_proxy
from fields.file_fields import file_fields, file_fields_with_signed_url
from models.model import App, EndUser
from services.file_service import FileService


class FileApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.FORM))
    @marshal_with(file_fields)
    def post(self, app_model: App, end_user: EndUser):
        file = request.files["file"]

        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if not file.mimetype:
            raise UnsupportedFileTypeError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        if not file.filename:
            raise FilenameNotExistsError

        try:
            upload_file = FileService.upload_file(
                filename=file.filename,
                content=file.read(),
                mimetype=file.mimetype,
                user=end_user,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return upload_file, 201


class RemoteFileApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.FORM))
    @marshal_with(file_fields_with_signed_url)
    def post(self, app_model: App, end_user: EndUser):
        parser = reqparse.RequestParser()
        parser.add_argument("url", type=str, required=True, help="URL is required", location="form")
        args = parser.parse_args()

        url = args["url"]

        try:
            resp = ssrf_proxy.head(url=url, timeout=5)
            if resp.status_code != httpx.codes.OK:
                resp = ssrf_proxy.get(url=url, timeout=10, follow_redirects=True)

            if resp.status_code != httpx.codes.OK:
                raise RemoteFileUploadError(f"Failed to fetch file from {url}: {resp.text}")
        except httpx.TimeoutException:
            raise RemoteFileUploadError(f"Request timed out while fetching file from {url}.")
        except httpx.RequestError as e:
            raise RemoteFileUploadError(f"Failed to fetch file from {url}: {str(e)}")
        except Exception as e:
            raise RemoteFileUploadError(f"An unexpected error occurred while fetching file from {url}.")

        file_info = helpers.guess_file_info_from_response(resp)

        if not FileService.is_file_size_within_limit(extension=file_info.extension, file_size=file_info.size):
            raise FileTooLargeError("File size exceeds the limit.")

        try:
            content = (
                resp.content
                if resp.request.method == "GET"
                else ssrf_proxy.get(url=url, timeout=10, follow_redirects=True).content
            )
        except httpx.TimeoutException:
            raise RemoteFileUploadError(f"Request timed out while downloading file content from {url}.")
        except httpx.RequestError as e:
            raise RemoteFileUploadError(f"Network error while downloading file content from {url}.")
        except Exception as e:
            raise RemoteFileUploadError(f"An unexpected error occurred while downloading file content from {url}.")

        if not content:
            raise RemoteFileUploadError("Fetched file content is empty.")

        try:
            upload_file = FileService.upload_file(
                filename=file_info.filename, content=content, mimetype=file_info.mimetype, user=end_user, source_url=url
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError("Unsupported file type.")
        except Exception as e:
            raise RemoteFileUploadError("Failed to save or process the fetched file.")

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


api.add_resource(FileApi, "/files/upload")
api.add_resource(RemoteFileApi, "/remote-files/upload")
