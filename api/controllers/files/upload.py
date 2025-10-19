from mimetypes import guess_extension

from flask_restx import Resource, reqparse
from flask_restx.api import HTTPStatus
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import Forbidden

import services
from controllers.common.errors import (
    FileTooLargeError,
    UnsupportedFileTypeError,
)
from controllers.console.wraps import setup_required
from controllers.files import files_ns
from controllers.inner_api.plugin.wraps import get_user
from core.file.helpers import verify_plugin_file_signature
from core.tools.tool_file_manager import ToolFileManager
from fields.file_fields import build_file_model

# Define parser for both documentation and validation
upload_parser = (
    reqparse.RequestParser()
    .add_argument("file", location="files", type=FileStorage, required=True, help="File to upload")
    .add_argument(
        "timestamp", type=str, required=True, location="args", help="Unix timestamp for signature verification"
    )
    .add_argument("nonce", type=str, required=True, location="args", help="Random string for signature verification")
    .add_argument("sign", type=str, required=True, location="args", help="HMAC signature for request validation")
    .add_argument("tenant_id", type=str, required=True, location="args", help="Tenant identifier")
    .add_argument("user_id", type=str, required=False, location="args", help="User identifier")
)


@files_ns.route("/upload/for-plugin")
class PluginUploadFileApi(Resource):
    @setup_required
    @files_ns.expect(upload_parser)
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
    @files_ns.marshal_with(build_file_model(files_ns), code=HTTPStatus.CREATED)
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
        # Parse and validate all arguments
        args = upload_parser.parse_args()

        file: FileStorage = args["file"]
        timestamp: str = args["timestamp"]
        nonce: str = args["nonce"]
        sign: str = args["sign"]
        tenant_id: str = args["tenant_id"]
        user_id: str | None = args.get("user_id")
        user = get_user(tenant_id, user_id)

        filename: str | None = file.filename
        mimetype: str | None = file.mimetype

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
            result = {
                "id": tool_file.id,
                "user_id": tool_file.user_id,
                "tenant_id": tool_file.tenant_id,
                "conversation_id": tool_file.conversation_id,
                "file_key": tool_file.file_key,
                "mimetype": tool_file.mimetype,
                "original_url": tool_file.original_url,
                "name": tool_file.name,
                "size": tool_file.size,
                "mime_type": mimetype,
                "extension": extension,
                "preview_url": preview_url,
            }

            return result, 201
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()
