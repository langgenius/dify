import httpx
from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, HttpUrl
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


class HumanInputRemoteFileUploadPayload(BaseModel):
    url: HttpUrl = Field(description="Remote file URL")


register_schema_models(web_ns, HumanInputRemoteFileUploadPayload, FileResponse, FileWithSignedUrl)


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


@web_ns.route("/form/human_input/files/upload")
class HumanInputFileUploadApi(Resource):
    def post(self):
        """Upload one local file for a HITL human input form."""

        token = _extract_hitl_upload_token()
        upload_service = _create_upload_service()
        context = _validate_context(upload_service, token)
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

        upload_service.record_upload_file(context=context, file_id=upload_file.id)
        response = FileResponse.model_validate(upload_file, from_attributes=True)
        return response.model_dump(mode="json"), 201


@web_ns.route("/form/human_input/files/remote-upload")
class HumanInputRemoteFileUploadApi(Resource):
    def post(self):
        """Upload one remote URL file for a HITL human input form."""

        token = _extract_hitl_upload_token()
        upload_service = _create_upload_service()
        context = _validate_context(upload_service, token)
        payload = HumanInputRemoteFileUploadPayload.model_validate(request.get_json(silent=True) or {})
        url = str(payload.url)

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

        upload_service.record_upload_file(context=context, file_id=upload_file.id)
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
