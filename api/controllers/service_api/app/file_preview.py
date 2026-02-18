import logging
from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.file_response import enforce_download_for_html
from controllers.common.schema import register_schema_model
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import (
    FileAccessDeniedError,
    FileNotFoundError,
)
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import App, EndUser, Message, MessageFile, UploadFile

logger = logging.getLogger(__name__)


class FilePreviewQuery(BaseModel):
    as_attachment: bool = Field(default=False, description="Download as attachment")


register_schema_model(service_api_ns, FilePreviewQuery)


@service_api_ns.route("/files/<uuid:file_id>/preview")
class FilePreviewApi(Resource):
    """
    Service API File Preview endpoint

    Provides secure file preview/download functionality for external API users.
    Files can only be accessed if they belong to messages within the requesting app's context.
    """

    @service_api_ns.expect(service_api_ns.models[FilePreviewQuery.__name__])
    @service_api_ns.doc("preview_file")
    @service_api_ns.doc(description="Preview or download a file uploaded via Service API")
    @service_api_ns.doc(params={"file_id": "UUID of the file to preview"})
    @service_api_ns.doc(
        responses={
            200: "File retrieved successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - file access denied",
            404: "File not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def get(self, app_model: App, end_user: EndUser, file_id: str):
        """
        Preview/Download a file that was uploaded via Service API.

        Provides secure file preview/download functionality.
        Files can only be accessed if they belong to messages within the requesting app's context.
        """
        file_id = str(file_id)

        # Parse query parameters
        args = FilePreviewQuery.model_validate(request.args.to_dict())

        # Validate file ownership and get file objects
        _, upload_file = self._validate_file_ownership(file_id, app_model.id)

        # Get file content generator
        try:
            generator = storage.load(upload_file.key, stream=True)
        except Exception as e:
            raise FileNotFoundError(f"Failed to load file content: {str(e)}")

        # Build response with appropriate headers
        response = self._build_file_response(generator, upload_file, args.as_attachment)

        return response

    def _validate_file_ownership(self, file_id: str, app_id: str) -> tuple[MessageFile, UploadFile]:
        """
        Validate that the file belongs to a message within the requesting app's context

        Security validations performed:
        1. File exists in MessageFile table (was used in a conversation)
        2. Message belongs to the requesting app
        3. UploadFile record exists and is accessible
        4. File tenant matches app tenant (additional security layer)

        Args:
            file_id: UUID of the file to validate
            app_id: UUID of the requesting app

        Returns:
            Tuple of (MessageFile, UploadFile) if validation passes

        Raises:
            FileNotFoundError: File or related records not found
            FileAccessDeniedError: File does not belong to the app's context
        """
        try:
            # Input validation
            if not file_id or not app_id:
                raise FileAccessDeniedError("Invalid file or app identifier")

            # First, find the MessageFile that references this upload file
            message_file = db.session.query(MessageFile).where(MessageFile.upload_file_id == file_id).first()

            if not message_file:
                raise FileNotFoundError("File not found in message context")

            # Get the message and verify it belongs to the requesting app
            message = (
                db.session.query(Message).where(Message.id == message_file.message_id, Message.app_id == app_id).first()
            )

            if not message:
                raise FileAccessDeniedError("File access denied: not owned by requesting app")

            # Get the actual upload file record
            upload_file = db.session.query(UploadFile).where(UploadFile.id == file_id).first()

            if not upload_file:
                raise FileNotFoundError("Upload file record not found")

            # Additional security: verify tenant isolation
            app = db.session.query(App).where(App.id == app_id).first()
            if app and upload_file.tenant_id != app.tenant_id:
                raise FileAccessDeniedError("File access denied: tenant mismatch")

            return message_file, upload_file

        except (FileNotFoundError, FileAccessDeniedError):
            # Re-raise our custom exceptions
            raise
        except Exception as e:
            # Log unexpected errors for debugging
            logger.exception(
                "Unexpected error during file ownership validation",
                extra={"file_id": file_id, "app_id": app_id, "error": str(e)},
            )
            raise FileAccessDeniedError("File access validation failed")

    def _build_file_response(self, generator, upload_file: UploadFile, as_attachment: bool = False) -> Response:
        """
        Build Flask Response object with appropriate headers for file streaming

        Args:
            generator: File content generator from storage
            upload_file: UploadFile database record
            as_attachment: Whether to set Content-Disposition as attachment

        Returns:
            Flask Response object with streaming file content
        """
        response = Response(
            generator,
            mimetype=upload_file.mime_type,
            direct_passthrough=True,
            headers={},
        )

        # Add Content-Length if known
        if upload_file.size and upload_file.size > 0:
            response.headers["Content-Length"] = str(upload_file.size)

        # Add Accept-Ranges header for audio/video files to support seeking
        if upload_file.mime_type in [
            "audio/mpeg",
            "audio/wav",
            "audio/mp4",
            "audio/ogg",
            "audio/flac",
            "audio/aac",
            "video/mp4",
            "video/webm",
            "video/quicktime",
            "audio/x-m4a",
        ]:
            response.headers["Accept-Ranges"] = "bytes"

        # Set Content-Disposition for downloads
        if as_attachment and upload_file.name:
            encoded_filename = quote(upload_file.name)
            response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
            # Override content-type for downloads to force download
            response.headers["Content-Type"] = "application/octet-stream"

        enforce_download_for_html(
            response,
            mime_type=upload_file.mime_type,
            filename=upload_file.name,
            extension=upload_file.extension,
        )

        # Add caching headers for performance
        response.headers["Cache-Control"] = "public, max-age=3600"  # Cache for 1 hour

        return response
