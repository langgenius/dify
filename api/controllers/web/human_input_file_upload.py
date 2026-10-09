"""HITL human input form file uploads.

This controller exposes a single public upload endpoint for both local files and
remote URLs. The caller always submits a multipart form: when a non-empty
``url`` field is present, the request follows the remote fetch flow; otherwise it
falls back to the local file upload flow.
"""

from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from werkzeug.datastructures import FileStorage

import services
from controllers.common.errors import (
    BlockedFileExtensionError,
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    RemoteFileAccessDeniedError,
    RemoteFileInvalidResponseError,
    RemoteFileInvalidUrlError,
    RemoteFileNotFoundError,
    RemoteFileUnavailableError,
    RemoteFileUrlBlockedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import JsonResponseWithStatus, register_schema_models
from controllers.web import web_ns
from extensions.ext_application_services import application_services
from fields.file_fields import FileResponse, FileWithSignedUrl
from libs.exception import BaseHTTPException
from libs.helper import dump_response
from services.human_input_file_upload_service import (
    HITL_UPLOAD_TOKEN_PREFIX,
    HumanInputFileUploadService,
    HumanInputUploadContext,
    InvalidUploadTokenError,
)
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


class InvalidUploadTokenBadRequestError(BaseHTTPException):
    error_code = "invalid_upload_token"
    description = "Invalid upload token."
    code = 400


class InvalidUploadTokenUnauthorizedError(BaseHTTPException):
    error_code = "invalid_upload_token"
    description = "Upload token is required."
    code = 401


class InvalidUploadTokenForbiddenError(BaseHTTPException):
    error_code = "invalid_upload_token"
    description = "Upload token is invalid or expired."
    code = 403


class HumanInputFileUploadFormPayload(BaseModel):
    """Parsed multipart form fields for HITL uploads."""

    model_config = ConfigDict(extra="ignore")

    url: HttpUrl | None = Field(default=None, description="Remote file URL")


register_schema_models(web_ns, HumanInputFileUploadFormPayload, FileResponse, FileWithSignedUrl)


def _extract_hitl_upload_token() -> str:
    """Read HITL upload token from Authorization without invoking other bearer auth chains."""

    authorization = request.headers.get("Authorization")
    if authorization is None:
        raise InvalidUploadTokenUnauthorizedError()

    parts = authorization.split()
    if len(parts) != 2:
        raise InvalidUploadTokenUnauthorizedError()

    scheme, token = parts
    if scheme.lower() != "bearer":
        raise InvalidUploadTokenBadRequestError()
    if not token:
        raise InvalidUploadTokenUnauthorizedError()
    if not token.startswith(HITL_UPLOAD_TOKEN_PREFIX):
        raise InvalidUploadTokenBadRequestError()
    return token


def _validate_context(service: HumanInputFileUploadService, token: str) -> HumanInputUploadContext:
    try:
        return service.validate_upload_token(token)
    except InvalidUploadTokenError as exc:
        raise InvalidUploadTokenForbiddenError() from exc


def _parse_local_upload_file() -> FileStorage:
    if "file" not in request.files:
        raise NoFileUploadedError()
    if len(request.files) > 1:
        raise TooManyFilesError()

    file = request.files["file"]
    if not file.filename:
        raise FilenameNotExistsError()

    return file


def _parse_upload_form() -> HumanInputFileUploadFormPayload:
    return HumanInputFileUploadFormPayload.model_validate(request.form.to_dict(flat=True))


def _upload_local_file(
    *,
    service: HumanInputFileUploadService,
    context: HumanInputUploadContext,
) -> dict[str, Any]:
    file = _parse_local_upload_file()

    try:
        upload_file = service.upload_local_file(
            context=context,
            filename=file.filename or "",
            content=file.read(),
            mimetype=file.mimetype,
        )
    except services.errors.file.FileTooLargeError as file_too_large_error:
        raise FileTooLargeError(file_too_large_error.description or "File size exceeded.") from file_too_large_error
    except services.errors.file.UnsupportedFileTypeError as error:
        raise UnsupportedFileTypeError() from error
    except services.errors.file.BlockedFileExtensionError as exc:
        raise BlockedFileExtensionError() from exc

    return dump_response(FileResponse, upload_file)


def _upload_remote_file(
    *,
    service: HumanInputFileUploadService,
    context: HumanInputUploadContext,
    url: str,
) -> dict[str, Any]:
    try:
        upload_file = service.upload_remote_file(context=context, url=url)
    except RemoteFileInvalidUrlServiceError as error:
        raise RemoteFileInvalidUrlError() from error
    except RemoteFileUrlBlockedServiceError as error:
        raise RemoteFileUrlBlockedError() from error
    except RemoteFileNotFoundServiceError as error:
        raise RemoteFileNotFoundError() from error
    except RemoteFileAccessDeniedServiceError as error:
        raise RemoteFileAccessDeniedError() from error
    except RemoteFileUnavailableServiceError as error:
        raise RemoteFileUnavailableError() from error
    except RemoteFileInvalidResponseServiceError as error:
        raise RemoteFileInvalidResponseError() from error
    except services.errors.file.FileTooLargeError as file_too_large_error:
        raise FileTooLargeError(file_too_large_error.description or "File size exceeded.") from file_too_large_error
    except services.errors.file.UnsupportedFileTypeError as error:
        raise UnsupportedFileTypeError() from error
    except services.errors.file.BlockedFileExtensionError as exc:
        raise BlockedFileExtensionError() from exc

    return dump_response(FileWithSignedUrl, upload_file)


@web_ns.route("/human-input-forms/files")
@web_ns.response(201, "File uploaded successfully", web_ns.models[FileResponse.__name__])
class HumanInputFileUploadApi(Resource):
    def post(self) -> JsonResponseWithStatus:
        """Upload one local file or remote URL file for a HITL human input form."""

        token = _extract_hitl_upload_token()
        upload_service = application_services().human_input_file_uploads
        context = _validate_context(upload_service, token)
        form = _parse_upload_form()

        # The browser always submits multipart/form-data. A non-empty `url`
        # switches the endpoint into the remote-fetch flow; otherwise the
        # request must carry a local `file`.
        if form.url is not None:
            response = _upload_remote_file(
                service=upload_service,
                context=context,
                url=str(form.url),
            )
        else:
            response = _upload_local_file(service=upload_service, context=context)

        # response-contract:ignore pre-dumped response. See above
        return response, 201
