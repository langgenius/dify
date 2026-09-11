from flask import request
from pydantic import BaseModel, Field

import services
from controllers.common import helpers
from controllers.common.errors import (
    BlockedFileExtensionError,
    FileTooLargeError,
    RemoteFileAccessDeniedError,
    RemoteFileInvalidResponseError,
    RemoteFileInvalidUrlError,
    RemoteFileNotFoundError,
    RemoteFileUnavailableError,
    RemoteFileUrlBlockedError,
    UnsupportedFileTypeError,
)
from controllers.console.wraps import model_validate
from extensions.ext_application_services import application_services
from fields.file_fields import FileWithSignedUrl, RemoteFileInfo
from libs.helper import dump_response
from models.model import App, EndUser
from services.remote_file_service import (
    RemoteFileAccessDeniedError as RemoteFileAccessDeniedServiceError,
)
from services.remote_file_service import (
    RemoteFileInvalidResponseError as RemoteFileInvalidResponseServiceError,
)
from services.remote_file_service import RemoteFileInvalidUrlError as RemoteFileInvalidUrlServiceError
from services.remote_file_service import RemoteFileNotFoundError as RemoteFileNotFoundServiceError
from services.remote_file_service import RemoteFileUnavailableError as RemoteFileUnavailableServiceError
from services.remote_file_service import RemoteFileUrlBlockedError as RemoteFileUrlBlockedServiceError

from ..common.schema import register_response_schema_models, register_schema_models
from . import web_ns
from .wraps import WebApiResource


class RemoteFileUploadPayload(BaseModel):
    url: str = Field(description="Remote file URL", json_schema_extra={"format": "uri"})


register_schema_models(web_ns, RemoteFileUploadPayload)
register_response_schema_models(web_ns, RemoteFileInfo, FileWithSignedUrl)


@web_ns.route("/remote-files/<path:url>")
class RemoteFileInfoApi(WebApiResource):
    @web_ns.doc("get_remote_file_info")
    @web_ns.doc(description="Get information about a remote file")
    @web_ns.doc(
        responses={
            200: "Remote file information retrieved successfully",
            400: "Invalid, blocked, or inaccessible remote file URL",
            404: "Remote file not found",
            502: "Remote file unavailable or returned an invalid response",
            500: "Internal server error",
        }
    )
    @web_ns.response(200, "Remote file info", web_ns.models[RemoteFileInfo.__name__])
    def get(self, app_model: App, end_user: EndUser, url: str):
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
        decoded_url = helpers.decode_remote_url(url, request.query_string)
        try:
            file_info = application_services().remote_files.fetch_info(url=decoded_url)
        except RemoteFileInvalidUrlServiceError as error:
            raise RemoteFileInvalidUrlError from error
        except RemoteFileUrlBlockedServiceError as error:
            raise RemoteFileUrlBlockedError from error
        except RemoteFileNotFoundServiceError as error:
            raise RemoteFileNotFoundError from error
        except RemoteFileAccessDeniedServiceError as error:
            raise RemoteFileAccessDeniedError from error
        except RemoteFileUnavailableServiceError as error:
            raise RemoteFileUnavailableError from error
        except RemoteFileInvalidResponseServiceError as error:
            raise RemoteFileInvalidResponseError from error

        return dump_response(
            RemoteFileInfo,
            {
                "file_type": file_info.content_type,
                "file_length": file_info.content_length if file_info.content_length is not None else -1,
            },
        )


@web_ns.route("/remote-files/upload")
class RemoteFileUploadApi(WebApiResource):
    @web_ns.doc("upload_remote_file")
    @web_ns.doc(description="Upload a file from a remote URL")
    @web_ns.doc(
        responses={
            201: "Remote file uploaded successfully",
            400: "Invalid, blocked, or inaccessible remote file URL",
            404: "Remote file not found",
            413: "File too large",
            415: "Unsupported file type",
            422: "Request payload validation failed",
            502: "Remote file unavailable or returned an invalid response",
            500: "Internal server error",
        }
    )
    @web_ns.response(201, "Remote file uploaded", web_ns.models[FileWithSignedUrl.__name__])
    @web_ns.expect(web_ns.models[RemoteFileUploadPayload.__name__])
    @model_validate(RemoteFileUploadPayload)
    def post(self, payload: RemoteFileUploadPayload, app_model: App, end_user: EndUser):
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
            RemoteFileInvalidUrlError: Remote file URL is invalid
            RemoteFileUrlBlockedError: Remote file URL is blocked
            RemoteFileNotFoundError: Remote file does not exist
            RemoteFileAccessDeniedError: Remote file requires authorization
            RemoteFileUnavailableError: Remote file is unavailable
            RemoteFileInvalidResponseError: Remote file response is invalid
            FileTooLargeError: File exceeds size limit
            UnsupportedFileTypeError: File type not supported
        """
        try:
            remote_file = application_services().remote_files.upload_from_url(
                url=payload.url,
                user=end_user,
            )
        except RemoteFileInvalidUrlServiceError as error:
            raise RemoteFileInvalidUrlError from error
        except RemoteFileUrlBlockedServiceError as error:
            raise RemoteFileUrlBlockedError from error
        except RemoteFileNotFoundServiceError as error:
            raise RemoteFileNotFoundError from error
        except RemoteFileAccessDeniedServiceError as error:
            raise RemoteFileAccessDeniedError from error
        except RemoteFileUnavailableServiceError as error:
            raise RemoteFileUnavailableError from error
        except RemoteFileInvalidResponseServiceError as error:
            raise RemoteFileInvalidResponseError from error
        except services.errors.file.FileTooLargeError as error:
            raise FileTooLargeError(error.description or "File size exceeded.") from error
        except services.errors.file.UnsupportedFileTypeError as error:
            raise UnsupportedFileTypeError from error
        except services.errors.file.BlockedFileExtensionError as error:
            raise BlockedFileExtensionError(error.description) from error

        return dump_response(FileWithSignedUrl, remote_file), 201
