import logging
from urllib.parse import quote

from flask import Response
from flask_restful import Resource, reqparse

from controllers.service_api import api
from controllers.service_api.app.error import (
    FileAccessDeniedError,
    FileNotFoundError,
)
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import App, EndUser, Message, MessageFile, UploadFile

logger = logging.getLogger(__name__)


class FilePreviewApi(Resource):
    """
    Service API File Preview endpoint

    Provides secure file preview/download functionality for external API users.
    Files can only be accessed if they belong to messages within the requesting app's context.
    """

    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def get(self, app_model: App, end_user: EndUser, file_id: str):
        """
        Preview/Download a file that was uploaded via Service API

        Args:
            app_model: The authenticated app model
            end_user: The authenticated end user (optional)
            file_id: UUID of the file to preview

        Query Parameters:
            user: Optional user identifier
            as_attachment: Boolean, whether to download as attachment (default: false)

        Returns:
            Stream response with file content

        Raises:
            FileNotFoundError: File does not exist
            FileAccessDeniedError: File access denied (not owned by app)
        """
        file_id = str(file_id)

        # Parse query parameters
        parser = reqparse.RequestParser()
        parser.add_argument("as_attachment", type=bool, required=False, default=False, location="args")
        args = parser.parse_args()

        # Validate file ownership and get file objects
        message_file, upload_file = self._validate_file_ownership(file_id, app_model.id)

        # Get file content generator
        try:
            generator = storage.load(upload_file.key, stream=True)
        except Exception as e:
            raise FileNotFoundError(f"Failed to load file content: {str(e)}")

        # Build response with appropriate headers
        response = self._build_file_response(generator, upload_file, args["as_attachment"])

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

        # Add caching headers for performance
        response.headers["Cache-Control"] = "public, max-age=3600"  # Cache for 1 hour

        return response


# Register the API endpoint
api.add_resource(FilePreviewApi, "/files/<uuid:file_id>/preview")
