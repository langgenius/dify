from urllib.parse import quote
from uuid import UUID

from flask import Response
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.fields import BinaryFileResponse
from controllers.common.file_response import enforce_download_for_html
from controllers.common.schema import query_params_from_model, register_response_schema_model, register_schema_model
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import (
    FileAccessDeniedError,
    FileNotFoundError,
)
from controllers.service_api.schema import binary_response
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from extensions.ext_application_services import application_services
from models.model import App, EndUser
from services.message_file_preview_service import (
    MessageFilePreview,
    MessageFilePreviewAccessDeniedError,
    MessageFilePreviewNotFoundError,
)


class FilePreviewQuery(BaseModel):
    as_attachment: bool = Field(
        default=False,
        description="If `true`, forces the file to download as an attachment instead of previewing in browser.",
    )


register_schema_model(service_api_ns, FilePreviewQuery)
register_response_schema_model(service_api_ns, BinaryFileResponse)

FILE_PREVIEW_RESPONSE_MEDIA_TYPE = "*/*"
_RANGE_MEDIA_TYPES = frozenset(
    {
        "audio/aac",
        "audio/flac",
        "audio/mp4",
        "audio/mpeg",
        "audio/ogg",
        "audio/wav",
        "audio/x-m4a",
        "video/mp4",
        "video/quicktime",
        "video/webm",
    }
)


@service_api_ns.route("/files/<uuid:file_id>/preview")
class FilePreviewApi(Resource):
    """
    Service API File Preview endpoint

    Provides secure file preview/download functionality for external API users.
    Files can only be accessed if they belong to messages within the requesting app's context.
    """

    @service_api_ns.doc(
        summary="Download File",
        description=(
            "Preview or download uploaded files previously uploaded via the [Upload "
            "File](/api-reference/files/upload-file) API. Files can only be accessed if they belong to "
            "messages within the requesting application."
        ),
        tags=["Files"],
        responses={
            200: (
                "Returns the raw file content. The `Content-Type` header is set to the file's MIME type. If "
                "`as_attachment` is `true`, the file is returned as a download with `Content-Disposition: "
                "attachment`."
            ),
            403: "`file_access_denied` : Access to the requested file is denied.",
            404: "`file_not_found` : The requested file was not found.",
        },
    )
    @service_api_ns.doc(params=query_params_from_model(FilePreviewQuery))
    @binary_response(service_api_ns, FILE_PREVIEW_RESPONSE_MEDIA_TYPE)
    @service_api_ns.doc("preview_file")
    @service_api_ns.doc(description="Preview or download a file uploaded via Service API")
    @service_api_ns.doc(
        params={
            "file_id": (
                "The unique identifier of the file to preview, obtained from the "
                "[Upload File](/api-reference/files/upload-file) API response."
            )
        }
    )
    @service_api_ns.doc(
        responses={
            200: "File retrieved successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - file access denied",
            404: "File not found",
        }
    )
    @service_api_ns.response(200, "File retrieved successfully")
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    @model_validate(FilePreviewQuery)
    def get(self, args: FilePreviewQuery, app_model: App, end_user: EndUser, file_id: UUID) -> Response:
        """
        Preview/Download a file that was uploaded via Service API.

        Provides secure file preview/download functionality.
        Files can only be accessed if they belong to messages within the requesting app's context.
        """
        try:
            preview = application_services().message_file_previews.get_preview(
                file_id=str(file_id),
                app_id=app_model.id,
                tenant_id=app_model.tenant_id,
            )
        except MessageFilePreviewNotFoundError as error:
            raise FileNotFoundError() from error
        except MessageFilePreviewAccessDeniedError as error:
            raise FileAccessDeniedError() from error

        return self._build_file_response(preview=preview, as_attachment=args.as_attachment)

    def _build_file_response(self, *, preview: MessageFilePreview, as_attachment: bool = False) -> Response:
        """
        Build Flask Response object with appropriate headers for file streaming

        Args:
            preview: App-scoped file metadata and content stream
            as_attachment: Whether to set Content-Disposition as attachment

        Returns:
            Flask Response object with streaming file content
        """
        file = preview.file
        response = Response(
            preview.content,
            mimetype=file.mime_type,
            direct_passthrough=True,
            headers={},
        )

        # Add Content-Length if known
        if file.size > 0:
            response.headers["Content-Length"] = str(file.size)

        # Add Accept-Ranges header for audio/video files to support seeking
        if file.mime_type in _RANGE_MEDIA_TYPES:
            response.headers["Accept-Ranges"] = "bytes"

        # Set Content-Disposition for downloads
        if as_attachment and file.name:
            encoded_filename = quote(file.name)
            response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
            # Override content-type for downloads to force download
            response.headers["Content-Type"] = "application/octet-stream"

        enforce_download_for_html(
            response,
            mime_type=file.mime_type,
            filename=file.name,
            extension=file.extension,
        )

        # Add caching headers for performance
        response.headers["Cache-Control"] = "public, max-age=3600"  # Cache for 1 hour

        return response
