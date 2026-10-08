import logging
from collections import OrderedDict
from http import HTTPStatus
from typing import NoReturn, cast

from flask import current_app, got_request_exception
from flask_restx import Api
from werkzeug.exceptions import HTTPException

from libs.exception import BaseHTTPException
from services.annotation.errors import AnnotationResourceNotFoundError
from services.errors.base import NoPermissionError
from services.errors.dataset import DatasetNotFoundError
from services.errors.document import DocumentAccessDeniedError, DocumentNotFoundError, DocumentSourceNotFoundError


class FilenameNotExistsError(BaseHTTPException):
    error_code = "filename_not_exists_error"
    code = 400
    description = "The specified filename does not exist."


class RemoteFileUploadError(BaseHTTPException):
    error_code = "remote_file_upload_error"
    code = 400
    description = "Error uploading remote file."


class RemoteFileInvalidUrlError(BaseHTTPException):
    error_code = "remote_file_invalid_url"
    description = "The remote file URL is invalid."
    code = 400


class RemoteFileUrlBlockedError(BaseHTTPException):
    error_code = "remote_file_url_blocked"
    description = "The remote file URL is not allowed."
    code = 400


class RemoteFileNotFoundError(BaseHTTPException):
    error_code = "remote_file_not_found"
    description = "The remote file could not be found."
    code = 404


class RemoteFileAccessDeniedError(BaseHTTPException):
    error_code = "remote_file_access_denied"
    description = "The remote file cannot be accessed without authorization."
    code = 400


class RemoteFileUnavailableError(BaseHTTPException):
    error_code = "remote_file_unavailable"
    description = "The remote file is temporarily unavailable."
    code = 502


class RemoteFileInvalidResponseError(BaseHTTPException):
    error_code = "remote_file_invalid_response"
    description = "The remote file server returned an invalid response."
    code = 502


class FileTooLargeError(BaseHTTPException):
    error_code = "file_too_large"
    description = "File size exceeded. {message}"
    code = 413


class UnsupportedFileTypeError(BaseHTTPException):
    error_code = "unsupported_file_type"
    description = "File type not allowed."
    code = 415


class BlockedFileExtensionError(BaseHTTPException):
    error_code = "file_extension_blocked"
    description = "The file extension is blocked for security reasons."
    code = 400


class TooManyFilesError(BaseHTTPException):
    error_code = "too_many_files"
    description = "Only one file is allowed."
    code = 400


class NoFileUploadedError(BaseHTTPException):
    error_code = "no_file_uploaded"
    description = "Please upload your file."
    code = 400


class NotFoundError(BaseHTTPException):
    error_code = "not_found"
    code = 404


class UnauthorizedError(BaseHTTPException):
    error_code = "unauthorized"
    code = HTTPStatus.UNAUTHORIZED
    description = "Authentication is required."


class InternalServerError(BaseHTTPException):
    """Expose a safe response while retaining the original exception in server logs."""

    error_code = "internal_server_error"
    code = HTTPStatus.INTERNAL_SERVER_ERROR
    description = (
        "The server encountered an internal error and was unable to complete your request. "
        "Either the server is overloaded or there is an error in the application."
    )


class InvalidArgumentError(BaseHTTPException):
    error_code = "invalid_param"
    code = 400


class InvalidRequestError(BaseHTTPException):
    error_code = "bad_request"
    code = 400
    description = "The browser (or proxy) sent a request that this server could not understand."


class AccessDeniedError(BaseHTTPException):
    error_code = "forbidden"
    code = 403
    description = (
        "You don't have the permission to access the requested resource. "
        "It is either read-protected or not readable by the server."
    )


class AuthenticationRequiredError(BaseHTTPException):
    error_code = "unauthorized"
    code = 401
    description = "Authentication is required."


class InternalServerError(BaseHTTPException):
    error_code = "internal_server_error"
    code = 500
    description = (
        "The server encountered an internal error and was unable to complete your request. "
        "Either the server is overloaded or there is an error in the application."
    )


class UnsupportedMediaTypeError(BaseHTTPException):
    error_code = "unsupported_media_type"
    code = 415
    description = "The server does not support the media type transmitted in the request."


class UnprocessableEntityError(BaseHTTPException):
    error_code = "unprocessable_entity"
    code = 422


class TooManyRequestsError(BaseHTTPException):
    error_code = "too_many_requests"
    code = 429
    description = "This user has exceeded an allotted request count. Try again later."


class RequestBodyTooLargeError(BaseHTTPException):
    error_code = "request_entity_too_large"
    code = 413


def raise_unexpected_error(error: Exception, *, message: str) -> NoReturn:
    """Keep HTTP failures intact and sanitize unclassified failures at the transport boundary.

    Framework request parsing and project HTTP errors may both reach a route's
    error translator. Neither should be converted to a generic server error.
    """
    if isinstance(error, HTTPException):
        raise error
    logging.getLogger(__name__).exception(message)
    raise InternalServerError() from error


def register_resource_error_handlers(api: Api) -> None:
    """Translate annotation and document failures at the HTTP boundary."""

    def missing_resource(error: Exception) -> tuple[dict[str, str | int], int]:
        got_request_exception.send(current_app, exception=error)
        return {"code": "not_found", "message": str(error), "status": 404}, 404

    def document_access_denied(error: DocumentAccessDeniedError) -> tuple[dict[str, str | int], int]:
        got_request_exception.send(current_app, exception=error)
        return {"code": "forbidden", "message": str(error), "status": 403}, 403

    for error_type in (
        AnnotationResourceNotFoundError,
        DatasetNotFoundError,
        DocumentNotFoundError,
        DocumentSourceNotFoundError,
    ):
        api.errorhandler(error_type)(missing_resource)
        cast(OrderedDict[type[Exception], object], api.error_handlers).move_to_end(error_type, last=False)
    api.errorhandler(DocumentAccessDeniedError)(document_access_denied)
    cast(OrderedDict[type[Exception], object], api.error_handlers).move_to_end(DocumentAccessDeniedError, last=False)


def register_permission_error_handler(api: Api) -> None:
    """Preserve the default permission-error response for Console and Service API."""

    @api.errorhandler(NoPermissionError)
    def handle_permission_error(error: NoPermissionError) -> tuple[dict[str, str | int], int]:
        got_request_exception.send(current_app, exception=error)
        return {
            "code": InvalidArgumentError.error_code,
            "message": str(error),
            "status": HTTPStatus.BAD_REQUEST,
        }, HTTPStatus.BAD_REQUEST

    # Flask-RESTX picks the first matching handler, including the generic Exception handler.
    cast(OrderedDict[type[Exception], object], api.error_handlers).move_to_end(NoPermissionError, last=False)
