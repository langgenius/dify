"""HITL human input form file uploads.

This controller exposes a single public upload endpoint for both local files and
remote URLs. The caller always submits a multipart form: when a non-empty
``url`` field is present, the request follows the remote fetch flow; otherwise it
falls back to the local file upload flow.
"""

import httpx
from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from sqlalchemy.orm import sessionmaker

import services
from controllers.common import helpers
from controllers.common.errors import (
    BlockedFileExtensionError,
    FileTooLargeError,
    NoFileUploadedError,
    RemoteFileUploadError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import register_schema_models
from controllers.web import web_ns
from core.helper import ssrf_proxy
from extensions.ext_database import db
from fields.file_fields import FileResponse, FileWithSignedUrl
from graphon.file import helpers as file_helpers
from libs.exception import BaseHTTPException
from libs.helper import dump_response
from repositories.factory import DifyAPIRepositoryFactory
from services.file_service import FileService
from services.human_input_file_upload_service import (
    HITL_UPLOAD_TOKEN_PREFIX,
    HumanInputFileUploadService,
    InvalidUploadTokenError,
)


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


def _create_upload_service() -> HumanInputFileUploadService:
    session_factory = sessionmaker(bind=db.engine)
    workflow_run_repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_factory)
    return HumanInputFileUploadService(
        session_factory=session_factory,
        workflow_run_repository=workflow_run_repository,
    )


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


def _validate_context(service: HumanInputFileUploadService, token: str):
    try:
        return service.validate_upload_token(token)
    except InvalidUploadTokenError as exc:
        raise InvalidUploadTokenForbiddenError() from exc


def _parse_local_upload_file():
    if "file" not in request.files:
        raise NoFileUploadedError()
    if len(request.files) > 1:
        raise TooManyFilesError()

    file = request.files["file"]
    if not file.filename:
        from controllers.common.errors import FilenameNotExistsError

        raise FilenameNotExistsError()

    return file


def _parse_upload_form() -> HumanInputFileUploadFormPayload:
    return HumanInputFileUploadFormPayload.model_validate(request.form.to_dict(flat=True))


def _upload_local_file(context):
    file = _parse_local_upload_file()

    try:
        upload_file = FileService(db.engine).upload_file(
            filename=file.filename or "",
            content=file.read(),
            mimetype=file.mimetype,
            user=context.owner,
            source=None,
        )
    except services.errors.file.FileTooLargeError as file_too_large_error:
        raise FileTooLargeError(file_too_large_error.description)
    except services.errors.file.UnsupportedFileTypeError:
        raise UnsupportedFileTypeError()
    except services.errors.file.BlockedFileExtensionError as exc:
        raise BlockedFileExtensionError() from exc

    return upload_file.id, dump_response(FileResponse, upload_file)


def _upload_remote_file(context, url: str):
    try:
        resp = ssrf_proxy.head(url=url)
        if resp.status_code != httpx.codes.OK:
            resp = ssrf_proxy.get(url=url, timeout=3, follow_redirects=True)
        if resp.status_code != httpx.codes.OK:
            raise RemoteFileUploadError(f"Failed to fetch file from {url}: {resp.text}")
    except httpx.RequestError as exc:
        raise RemoteFileUploadError(f"Failed to fetch file from {url}: {str(exc)}")

    file_info = helpers.guess_file_info_from_response(resp)
    if not FileService.is_file_size_within_limit(extension=file_info.extension, file_size=file_info.size):
        raise FileTooLargeError()

    content = resp.content if resp.request.method == "GET" else ssrf_proxy.get(url).content

    try:
        upload_file = FileService(db.engine).upload_file(
            filename=file_info.filename,
            content=content,
            mimetype=file_info.mimetype,
            user=context.owner,
            source_url=url,
        )
    except services.errors.file.FileTooLargeError as file_too_large_error:
        raise FileTooLargeError(file_too_large_error.description)
    except services.errors.file.UnsupportedFileTypeError:
        raise UnsupportedFileTypeError()
    except services.errors.file.BlockedFileExtensionError as exc:
        raise BlockedFileExtensionError() from exc

    response = FileWithSignedUrl(
        id=upload_file.id,
        name=upload_file.name,
        size=upload_file.size,
        extension=upload_file.extension,
        url=file_helpers.get_signed_file_url(upload_file_id=upload_file.id),
        mime_type=upload_file.mime_type,
        created_by=upload_file.created_by,
        created_at=int(upload_file.created_at.timestamp()),
    )
    return upload_file.id, response.model_dump(mode="json")


@web_ns.route("/human-input-forms/files")
@web_ns.response(201, "File uploaded successfully", web_ns.models[FileResponse.__name__])
class HumanInputFileUploadApi(Resource):
    def post(self):
        """Upload one local file or remote URL file for a HITL human input form."""

        token = _extract_hitl_upload_token()
        upload_service = _create_upload_service()
        context = _validate_context(upload_service, token)
        form = _parse_upload_form()

        # The browser always submits multipart/form-data. A non-empty `url`
        # switches the endpoint into the remote-fetch flow; otherwise the
        # request must carry a local `file`.
        if form.url is not None:
            file_id, response = _upload_remote_file(context=context, url=str(form.url))
        else:
            file_id, response = _upload_local_file(context=context)

        upload_service.record_upload_file(context=context, file_id=file_id)
        # response-contract:ignore pre-dumped response. See above
        return response, 201
