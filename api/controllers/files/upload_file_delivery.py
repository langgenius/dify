import os
from urllib.parse import quote
from uuid import UUID

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import NotFound

from controllers.common.errors import UnsupportedFileTypeError
from controllers.common.file_response import enforce_download_for_html
from controllers.common.schema import query_params_from_model, register_schema_models
from controllers.files import files_ns
from extensions.ext_application_services import application_services
from services.errors.file import UnsupportedFileTypeError as UnsupportedFileTypeServiceError
from services.upload_file_delivery_service import (
    UploadFileDelivery,
    UploadFileDeliveryNotFoundError,
)


class FileSignatureQuery(BaseModel):
    timestamp: str = Field(..., description="Unix timestamp used in the signature")
    nonce: str = Field(..., description="Random string for signature")
    sign: str = Field(..., description="HMAC signature")


class FilePreviewQuery(FileSignatureQuery):
    as_attachment: bool = Field(default=False, description="Whether to download as attachment")


register_schema_models(files_ns, FileSignatureQuery, FilePreviewQuery)

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


def _is_svg_content(mime_type: str | None, filename: str | None, extension: str | None) -> bool:
    normalized_mime_type = mime_type.split(";", 1)[0].strip().lower() if mime_type else ""
    if normalized_mime_type == "image/svg+xml":
        return True

    normalized_extension = extension.lstrip(".").lower() if extension else ""
    if normalized_extension == "svg":
        return True

    return bool(filename and os.path.splitext(filename)[1].lstrip(".").lower() == "svg")


@files_ns.route("/<uuid:file_id>/image-preview")
class ImagePreviewApi(Resource):
    """Deprecated endpoint for retrieving image previews."""

    @files_ns.doc("get_image_preview")
    @files_ns.doc(description="Retrieve a signed image preview for a file")
    @files_ns.doc(
        params={
            "file_id": "ID of the file to preview",
            **query_params_from_model(FileSignatureQuery),
        }
    )
    @files_ns.doc(
        responses={
            200: "Image preview returned successfully",
            400: "Missing or invalid query parameters",
            404: "File not found or signature is invalid",
            415: "Unsupported file type",
        }
    )
    def get(self, file_id: UUID) -> Response:
        args = FileSignatureQuery.model_validate(request.args.to_dict(flat=True))
        try:
            delivery = application_services().upload_file_delivery.get_signed_image_preview(
                file_id=str(file_id),
                timestamp=args.timestamp,
                nonce=args.nonce,
                sign=args.sign,
            )
        except UploadFileDeliveryNotFoundError as error:
            raise NotFound(str(error) or None) from error
        except UnsupportedFileTypeServiceError as error:
            raise UnsupportedFileTypeError() from error

        return Response(delivery.content, mimetype=delivery.file.mime_type)


@files_ns.route("/<uuid:file_id>/file-preview")
class FilePreviewApi(Resource):
    @files_ns.doc("get_file_preview")
    @files_ns.doc(description="Download a file preview or attachment using signed parameters")
    @files_ns.doc(
        params={
            "file_id": "ID of the file to preview",
            **query_params_from_model(FilePreviewQuery),
        }
    )
    @files_ns.doc(
        responses={
            200: "File stream returned successfully",
            400: "Missing or invalid query parameters",
            404: "File not found or signature is invalid",
        }
    )
    def get(self, file_id: UUID) -> Response:
        args = FilePreviewQuery.model_validate(request.args.to_dict(flat=True))

        try:
            delivery = application_services().upload_file_delivery.get_signed_file_preview(
                file_id=str(file_id),
                timestamp=args.timestamp,
                nonce=args.nonce,
                sign=args.sign,
            )
        except UploadFileDeliveryNotFoundError as error:
            raise NotFound(str(error) or None) from error

        return self._build_response(delivery=delivery, as_attachment=args.as_attachment)

    @staticmethod
    def _build_response(*, delivery: UploadFileDelivery, as_attachment: bool) -> Response:
        file = delivery.file
        response = Response(delivery.content, mimetype=file.mime_type, direct_passthrough=True, headers={})
        if file.mime_type in _RANGE_MEDIA_TYPES:
            response.headers["Accept-Ranges"] = "bytes"
        if file.size > 0:
            response.headers["Content-Length"] = str(file.size)
        is_svg = _is_svg_content(file.mime_type, file.name, file.extension)
        if as_attachment or is_svg:
            encoded_filename = quote(file.name)
            response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
            response.headers["Content-Type"] = "application/octet-stream"
        if is_svg:
            response.headers["X-Content-Type-Options"] = "nosniff"

        enforce_download_for_html(
            response,
            mime_type=file.mime_type,
            filename=file.name,
            extension=file.extension,
        )

        return response


@files_ns.route("/workspaces/<uuid:workspace_id>/webapp-logo")
class WorkspaceWebappLogoApi(Resource):
    @files_ns.doc("get_workspace_webapp_logo")
    @files_ns.doc(description="Fetch the custom webapp logo for a workspace")
    @files_ns.doc(
        params={
            "workspace_id": "Workspace identifier",
        }
    )
    @files_ns.doc(
        responses={
            200: "Logo returned successfully",
            404: "Webapp logo not configured",
            415: "Unsupported file type",
        }
    )
    def get(self, workspace_id: UUID) -> Response:
        try:
            delivery = application_services().upload_file_delivery.get_workspace_webapp_logo(
                workspace_id=str(workspace_id),
            )
        except UploadFileDeliveryNotFoundError as error:
            raise NotFound(str(error) or None) from error
        except UnsupportedFileTypeServiceError as error:
            raise UnsupportedFileTypeError() from error

        return Response(delivery.content, mimetype=delivery.file.mime_type)
