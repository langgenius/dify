from typing import Literal

from flask import request
from flask_restx import Resource
from flask_restx.api import HTTPStatus
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden

import services
from core.db.session_factory import session_factory
from core.tools.signature import verify_plugin_file_signature
from core.tools.tool_file_manager import ToolFileManager, resolve_extension
from core.workflow.file_reference import build_file_reference
from fields.file_fields import FileResponse
from services.account_service import TenantService

from ..common.errors import (
    FileTooLargeError,
    UnsupportedFileTypeError,
)
from ..common.schema import register_schema_models
from ..console.wraps import setup_required
from ..files import files_ns
from ..inner_api.plugin.wraps import get_user


class PluginUploadQuery(BaseModel):
    timestamp: str = Field(..., description="Unix timestamp for signature verification")
    nonce: str = Field(..., description="Random nonce for signature verification")
    sign: str = Field(..., description="HMAC signature")
    tenant_id: str = Field(..., description="Tenant identifier")
    user_id: str | None = Field(default=None, description="User identifier")
    user_from: Literal["account", "end-user"] | None = Field(default=None, description="User identity type")
    conversation_id: str | None = Field(default=None, description="Conversation identifier")
    max_size: int | None = Field(default=None, ge=0, description="Signed maximum file size in bytes")


register_schema_models(files_ns, PluginUploadQuery)


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
            dict: File metadata including ID, canonical ``reference`` for
                output-file reconstruction, URLs, and properties
            int: HTTP status code (201 for success)

        Raises:
            Forbidden: Invalid signature or missing required parameters
            FileTooLargeError: File exceeds size limit
            UnsupportedFileTypeError: File type not supported
        """
        args = PluginUploadQuery.model_validate(request.args.to_dict(flat=True))

        file = request.files.get("file")
        if file is None:
            raise Forbidden("File is required.")

        timestamp = args.timestamp
        nonce = args.nonce
        sign = args.sign
        tenant_id = args.tenant_id
        if args.user_from == "account":
            if args.user_id is None:
                raise Forbidden("Invalid request.")
            with session_factory.create_session() as session:
                is_tenant_member = TenantService.account_belongs_to_tenant(
                    args.user_id,
                    tenant_id,
                    session=session,
                )
            if not is_tenant_member:
                raise Forbidden("Invalid request.")
            owner_id = args.user_id
        else:
            owner_id = get_user(tenant_id, args.user_id).id

        filename = file.filename
        mimetype = file.mimetype

        if not filename or not mimetype:
            raise Forbidden("Invalid request.")

        if not verify_plugin_file_signature(
            filename=filename,
            mimetype=mimetype,
            tenant_id=tenant_id,
            user_id=owner_id,
            conversation_id=args.conversation_id,
            user_from=args.user_from,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
            max_size=args.max_size,
        ):
            raise Forbidden("Invalid request.")

        try:
            if args.max_size is None:
                file_binary = file.stream.read()
            else:
                file_binary = file.stream.read(args.max_size + 1)
                if len(file_binary) > args.max_size:
                    raise FileTooLargeError("File size exceeds the signed upload limit.")

            tool_file = ToolFileManager().create_file_by_raw(
                user_id=owner_id,
                tenant_id=tenant_id,
                file_binary=file_binary,
                mimetype=mimetype,
                filename=filename,
                conversation_id=args.conversation_id,
            )

            extension = resolve_extension(filename=tool_file.name, mimetype=tool_file.mimetype)
            preview_url = ToolFileManager.sign_file(tool_file_id=tool_file.id, extension=extension)

            # Create a dictionary with all the necessary attributes
            result = FileResponse(
                id=tool_file.id,
                reference=build_file_reference(record_id=tool_file.id),
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
