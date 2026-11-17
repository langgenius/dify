from urllib.parse import quote
from uuid import UUID

from flask import Response
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.file_response import harden_active_content_response
from controllers.common.schema import query_params_from_model, register_schema_models
from controllers.console.wraps import model_validate
from controllers.files import files_ns
from extensions.ext_application_services import application_services
from services.tool_file_download_service import (
    ToolFileDownload,
    ToolFileDownloadAccessDeniedError,
    ToolFileDownloadNotFoundError,
)


class ToolFileQuery(BaseModel):
    timestamp: str = Field(..., description="Unix timestamp")
    nonce: str = Field(..., description="Random nonce")
    sign: str = Field(..., description="HMAC signature")
    as_attachment: bool = Field(default=False, description="Download as attachment")


register_schema_models(files_ns, ToolFileQuery)


@files_ns.route("/tools/<uuid:file_id>.<string:extension>")
class ToolFileApi(Resource):
    @files_ns.doc("get_tool_file")
    @files_ns.doc(description="Download a tool file by ID using signed parameters")
    @files_ns.doc(
        params={
            "file_id": "Tool file identifier",
            "extension": "Expected file extension",
            **query_params_from_model(ToolFileQuery),
        }
    )
    @files_ns.doc(
        responses={
            200: "Tool file stream returned successfully",
            403: "Forbidden - invalid signature",
            404: "File not found",
        }
    )
    @model_validate(ToolFileQuery)
    def get(self, args: ToolFileQuery, file_id: UUID, extension: str) -> Response:
        """Validate the signed request before streaming; active content is sandboxed."""
        try:
            download = application_services().tool_file_downloads.get_signed_file(
                file_id=str(file_id),
                timestamp=args.timestamp,
                nonce=args.nonce,
                sign=args.sign,
            )
        except ToolFileDownloadAccessDeniedError as error:
            raise Forbidden("Invalid request.") from error
        except ToolFileDownloadNotFoundError as error:
            raise NotFound("file is not found") from error

        return self._build_response(download=download, as_attachment=args.as_attachment, extension=extension)

    @staticmethod
    def _build_response(*, download: ToolFileDownload, as_attachment: bool, extension: str) -> Response:
        """Stream a verified file; sandbox SVG previews and download other active content."""
        response = Response(
            download.content,
            mimetype=download.mime_type,
            direct_passthrough=True,
            headers={},
        )
        if download.size > 0:
            response.headers["Content-Length"] = str(download.size)
        if as_attachment and download.filename:
            encoded_filename = quote(download.filename)
            response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"

        harden_active_content_response(
            response,
            mime_type=download.mime_type,
            filename=download.filename,
            extension=extension,
            inline_svg=not as_attachment,
        )

        return response
