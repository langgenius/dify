from mimetypes import guess_extension

from flask import request
from flask_restx import Resource
from flask_restx.api import HTTPStatus
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden

import services
from core.file.helpers import verify_plugin_file_signature
from core.tools.tool_file_manager import ToolFileManager
from fields.file_fields import FileResponse

from ..common.errors import (
    FileTooLargeError,
    UnsupportedFileTypeError,
)
from ..common.schema import register_schema_models
from ..console.wraps import setup_required
from ..files import files_ns
from ..inner_api.plugin.wraps import get_user

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class PluginUploadQuery(BaseModel):
    timestamp: str = Field(..., description="Unix timestamp for signature verification")
    nonce: str = Field(..., description="Random nonce for signature verification")
    sign: str = Field(..., description="HMAC signature")
    tenant_id: str = Field(..., description="Tenant identifier")
    user_id: str | None = Field(default=None, description="User identifier")


files_ns.schema_model(
    PluginUploadQuery.__name__, PluginUploadQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)

register_schema_models(files_ns, FileResponse)


@files_ns.route("/upload/for-plugin")
class PluginUploadFileApi(Resource):
    @setup_required
    @files_ns.expect(files_ns.models[PluginUploadQuery.__name__])
    @files_ns.doc("upload_plugin_file")
    @files_ns.doc(description="Upload a file for plugin usage with signature verification")
    @files_ns.doc(
        responses={
            201: "File uploaded successfully",
            400: "Invalid request parameters",
            403: "Forbidden - Invalid signature or missing parameters",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @files_ns.response(HTTPStatus.CREATED, "File uploaded", files_ns.models[FileResponse.__name__])
    def post(self):
        """Upload a file for plugin usage.

        Accepts a file upload with signature verification for security.
        The file must be accompanied by valid timestamp, nonce, and signature parameters.

        Returns:
            dict: File metadata including ID, URLs, and properties
            int: HTTP status code (201 for success)

        Raises:
            Forbidden: Invalid signature or missing required parameters
            FileTooLargeError: File exceeds size limit
            UnsupportedFileTypeError: File type not supported
        """
        args = PluginUploadQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        file = request.files.get("file")
        if file is None:
            raise Forbidden("File is required.")

        timestamp = args.timestamp
        nonce = args.nonce
        sign = args.sign
        tenant_id = args.tenant_id
        user_id = args.user_id
        user = get_user(tenant_id, user_id)

        filename = file.filename
        mimetype = file.mimetype

        if not filename or not mimetype:
            raise Forbidden("Invalid request.")

        if not verify_plugin_file_signature(
            filename=filename,
            mimetype=mimetype,
            tenant_id=tenant_id,
            user_id=user.id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
        ):
            raise Forbidden("Invalid request.")

        try:
            tool_file = ToolFileManager().create_file_by_raw(
                user_id=user.id,
                tenant_id=tenant_id,
                file_binary=file.read(),
                mimetype=mimetype,
                filename=filename,
                conversation_id=None,
            )

            extension = guess_extension(tool_file.mimetype) or ".bin"
            preview_url = ToolFileManager.sign_file(tool_file_id=tool_file.id, extension=extension)

            # Create a dictionary with all the necessary attributes
            result = FileResponse(
                id=tool_file.id,
                name=tool_file.name,
                size=tool_file.size,
                extension=extension,
                mime_type=mimetype,
                preview_url=preview_url,
                source_url=tool_file.original_url,
                original_url=tool_file.original_url,
                user_id=tool_file.user_id,
                tenant_id=tool_file.tenant_id,
                conversation_id=tool_file.conversation_id,
                file_key=tool_file.file_key,
            )

            return result.model_dump(mode="json"), 201
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()
