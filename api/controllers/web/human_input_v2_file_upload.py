"""Public bearer-only file upload transport for v2 approval grants."""

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, HttpUrl, ValidationError
from werkzeug.exceptions import BadRequest

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
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.web import web_ns
from controllers.web.human_input_file_upload import (
    HumanInputFileUploadFormPayload,
    InvalidUploadTokenBadRequestError,
    InvalidUploadTokenForbiddenError,
    InvalidUploadTokenUnauthorizedError,
)
from controllers.web.human_input_form_access_request import _public_form_error_response
from fields.file_fields import FileWithSignedUrl
from libs.helper import dump_response
from services import remote_file_service as remote_errors
from services.errors import file as file_errors
from services.human_input_file_upload_service import InvalidUploadTokenError
from services.human_input_v2.file_upload_service import V2_UPLOAD_TOKEN_PREFIX, build_file_upload_service
from services.human_input_v2.submission_service import HumanInputFormError

register_response_schema_models(web_ns, FileWithSignedUrl)


@web_ns.route("/human-input/v2/files")
class HumanInputV2FileUploadApi(Resource):
    @web_ns.doc(
        description="Upload a file or a remote URL using a v2 upload grant.",
        consumes=["multipart/form-data"],
        security=[],
        params={
            "Authorization": {
                "in": "header",
                "type": "string",
                "required": True,
                "description": "Bearer v2 upload grant",
            },
            "file": {"in": "formData", "type": "file", "required": False},
            "url": {"in": "formData", "type": "string", "required": False, "description": "Remote HTTP(S) file URL"},
        },
        responses={
            400: "Invalid upload",
            401: "Grant required",
            403: "Invalid grant",
            404: "Form not found",
            412: "Form inactive",
        },
    )
    @web_ns.response(201, "File uploaded", web_ns.models[FileWithSignedUrl.__name__])
    def post(self):
        return _upload_file(remote=False)


class HumanInputV2RemoteUploadPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: HttpUrl


register_schema_models(web_ns, HumanInputV2RemoteUploadPayload)


@web_ns.route("/human-input/v2/files/remote")
class HumanInputV2RemoteFileUploadApi(Resource):
    @web_ns.doc(
        description="Fetch a remote file using a v2 upload grant.",
        security=[],
        params={"Authorization": {"in": "header", "type": "string", "required": True}},
        responses={
            400: "Invalid upload",
            401: "Grant required",
            403: "Invalid grant",
            404: "Form not found",
            412: "Form inactive",
        },
    )
    @web_ns.expect(web_ns.models[HumanInputV2RemoteUploadPayload.__name__])
    @web_ns.response(201, "File uploaded", web_ns.models[FileWithSignedUrl.__name__])
    def post(self):
        return _upload_file(remote=True)


def _upload_file(*, remote: bool):
    authorization = request.headers.get("Authorization", "").split()
    if len(authorization) != 2:
        raise InvalidUploadTokenUnauthorizedError()
    scheme, token = authorization
    if scheme.lower() != "bearer" or not token.startswith(V2_UPLOAD_TOKEN_PREFIX):
        raise InvalidUploadTokenBadRequestError()
    service = build_file_upload_service()
    try:
        context = service.validate_upload_token(token)
    except InvalidUploadTokenError as error:
        raise InvalidUploadTokenForbiddenError() from error
    except HumanInputFormError as error:
        return _public_form_error_response(error)
    try:
        if remote:
            payload = HumanInputV2RemoteUploadPayload.model_validate(web_ns.payload or {})
            form = HumanInputFileUploadFormPayload(url=payload.url)
        else:
            form = HumanInputFileUploadFormPayload.model_validate(request.form.to_dict(flat=True))
    except ValidationError as error:
        raise RemoteFileInvalidUrlError() from error
    if len(request.files.getlist("file")) > 1 or len(request.files) > 1:
        raise TooManyFilesError()
    if form.url is not None and request.files:
        raise BadRequest("Provide either a file or a URL.")
    try:
        if form.url is not None:
            uploaded = service.upload_remote_file(context=context, url=str(form.url))
        else:
            file = request.files.get("file")
            if file is None:
                raise NoFileUploadedError()
            if not file.filename:
                raise FilenameNotExistsError()
            uploaded = service.upload_local_file(
                context=context, filename=file.filename, content=file.read(), mimetype=file.mimetype
            )
    except file_errors.FileTooLargeError as error:
        raise FileTooLargeError(error.description or "File size exceeded.") from error
    except file_errors.UnsupportedFileTypeError as error:
        raise UnsupportedFileTypeError() from error
    except file_errors.BlockedFileExtensionError as error:
        raise BlockedFileExtensionError() from error
    except remote_errors.RemoteFileInvalidUrlError as error:
        raise RemoteFileInvalidUrlError() from error
    except remote_errors.RemoteFileUrlBlockedError as error:
        raise RemoteFileUrlBlockedError() from error
    except remote_errors.RemoteFileNotFoundError as error:
        raise RemoteFileNotFoundError() from error
    except remote_errors.RemoteFileAccessDeniedError as error:
        raise RemoteFileAccessDeniedError() from error
    except remote_errors.RemoteFileUnavailableError as error:
        raise RemoteFileUnavailableError() from error
    except remote_errors.RemoteFileInvalidResponseError as error:
        raise RemoteFileInvalidResponseError() from error
    return dump_response(FileWithSignedUrl, uploaded), 201
