"""Signed plugin file upload endpoint."""

from typing import Literal

from flask import request
from flask_restx import Resource
from flask_restx.api import HTTPStatus
from pydantic import BaseModel, Field

from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import (
    JsonResponseWithStatus,
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console.wraps import setup_required
from controllers.files import files_ns
from extensions.ext_application_services import application_services
from fields.file_fields import FileResponse
from libs.exception import BaseHTTPException
from libs.helper import dump_response
from services.errors.file import FileTooLargeError as ServiceFileTooLargeError
from services.errors.file import UnsupportedFileTypeError as ServiceUnsupportedFileTypeError
from services.plugin_file_upload_service import PluginFileUploadAccessDeniedError


class PluginUploadQuery(BaseModel):
    timestamp: str = Field(..., description="Unix timestamp for signature verification")
    nonce: str = Field(..., description="Random nonce for signature verification")
    sign: str = Field(..., description="HMAC signature")
    tenant_id: str = Field(..., description="Tenant identifier")
    user_id: str = Field(..., description="User identifier")
    user_from: Literal["account", "end-user"] | None = Field(default=None, description="User identity type")
    conversation_id: str | None = Field(default=None, description="Conversation identifier")
    max_size: int | None = Field(default=None, ge=0, description="Signed maximum file size in bytes")


class InvalidPluginFileUploadError(BaseHTTPException):
    error_code = "invalid_plugin_file_upload"
    description = "The plugin file upload request is invalid or expired."
    code = HTTPStatus.FORBIDDEN


_PLUGIN_UPLOAD_PARAMS = {
    **query_params_from_model(PluginUploadQuery),
    "file": {
        "description": "File to upload for plugin usage.",
        "in": "formData",
        "type": "file",
        "required": True,
    },
}


register_schema_models(files_ns, PluginUploadQuery)
register_response_schema_models(files_ns, FileResponse)


@files_ns.route("/upload/for-plugin")
class PluginUploadFileApi(Resource):
    @setup_required
    @files_ns.doc("upload_plugin_file")
    @files_ns.doc(
        description="Upload a file for plugin usage with signature verification",
        consumes=["multipart/form-data"],
        params=_PLUGIN_UPLOAD_PARAMS,
        responses={
            201: "File uploaded successfully",
            400: "Invalid query parameters, no file was uploaded, or the file has no name",
            403: "The signed upload request is invalid or expired",
            413: "File too large",
            415: "Unsupported file type",
        },
    )
    @files_ns.response(HTTPStatus.CREATED, "File uploaded", files_ns.models[FileResponse.__name__])
    def post(self) -> JsonResponseWithStatus:
        args = PluginUploadQuery.model_validate(request.args.to_dict(flat=True))
        file = request.files.get("file")
        if file is None:
            raise NoFileUploadedError()
        if not file.filename:
            raise FilenameNotExistsError()
        if not file.mimetype:
            raise UnsupportedFileTypeError()

        try:
            result = application_services().plugin_file_uploads.upload(
                stream=file.stream,
                filename=file.filename,
                mimetype=file.mimetype,
                tenant_id=args.tenant_id,
                user_id=args.user_id,
                user_from=args.user_from,
                conversation_id=args.conversation_id,
                timestamp=args.timestamp,
                nonce=args.nonce,
                sign=args.sign,
                max_size=args.max_size,
            )
        except PluginFileUploadAccessDeniedError as error:
            raise InvalidPluginFileUploadError() from error
        except ServiceFileTooLargeError as error:
            raise FileTooLargeError(error.description) from error
        except ServiceUnsupportedFileTypeError as error:
            raise UnsupportedFileTypeError() from error

        return dump_response(FileResponse, result), HTTPStatus.CREATED
