from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource, reqparse
from werkzeug.exceptions import NotFound

import services
from controllers.common.errors import UnsupportedFileTypeError
from controllers.files import files_ns
from extensions.ext_database import db
from services.account_service import TenantService
from services.file_service import FileService


@files_ns.route("/<uuid:file_id>/image-preview")
class ImagePreviewApi(Resource):
    """Deprecated endpoint for retrieving image previews."""

    @files_ns.doc("get_image_preview")
    @files_ns.doc(description="Retrieve a signed image preview for a file")
    @files_ns.doc(
        params={
            "file_id": "ID of the file to preview",
            "timestamp": "Unix timestamp used in the signature",
            "nonce": "Random string used in the signature",
            "sign": "HMAC signature verifying the request",
        }
    )
    @files_ns.doc(
        responses={
            200: "Image preview returned successfully",
            400: "Missing or invalid signature parameters",
            415: "Unsupported file type",
        }
    )
    def get(self, file_id):
        file_id = str(file_id)

        timestamp = request.args.get("timestamp")
        nonce = request.args.get("nonce")
        sign = request.args.get("sign")

        if not timestamp or not nonce or not sign:
            return {"content": "Invalid request."}, 400

        try:
            generator, mimetype = FileService(db.engine).get_image_preview(
                file_id=file_id,
                timestamp=timestamp,
                nonce=nonce,
                sign=sign,
            )
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return Response(generator, mimetype=mimetype)


@files_ns.route("/<uuid:file_id>/file-preview")
class FilePreviewApi(Resource):
    @files_ns.doc("get_file_preview")
    @files_ns.doc(description="Download a file preview or attachment using signed parameters")
    @files_ns.doc(
        params={
            "file_id": "ID of the file to preview",
            "timestamp": "Unix timestamp used in the signature",
            "nonce": "Random string used in the signature",
            "sign": "HMAC signature verifying the request",
            "as_attachment": "Whether to download the file as an attachment",
        }
    )
    @files_ns.doc(
        responses={
            200: "File stream returned successfully",
            400: "Missing or invalid signature parameters",
            404: "File not found",
            415: "Unsupported file type",
        }
    )
    def get(self, file_id):
        file_id = str(file_id)

        parser = (
            reqparse.RequestParser()
            .add_argument("timestamp", type=str, required=True, location="args")
            .add_argument("nonce", type=str, required=True, location="args")
            .add_argument("sign", type=str, required=True, location="args")
            .add_argument("as_attachment", type=bool, required=False, default=False, location="args")
        )

        args = parser.parse_args()

        if not args["timestamp"] or not args["nonce"] or not args["sign"]:
            return {"content": "Invalid request."}, 400

        try:
            generator, upload_file = FileService(db.engine).get_file_generator_by_file_id(
                file_id=file_id,
                timestamp=args["timestamp"],
                nonce=args["nonce"],
                sign=args["sign"],
            )
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        response = Response(
            generator,
            mimetype=upload_file.mime_type,
            direct_passthrough=True,
            headers={},
        )
        # add Accept-Ranges header for audio/video files
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
        if upload_file.size > 0:
            response.headers["Content-Length"] = str(upload_file.size)
        if args["as_attachment"]:
            encoded_filename = quote(upload_file.name)
            response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
            response.headers["Content-Type"] = "application/octet-stream"

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
    def get(self, workspace_id):
        workspace_id = str(workspace_id)

        custom_config = TenantService.get_custom_config(workspace_id)
        webapp_logo_file_id = custom_config.get("replace_webapp_logo") if custom_config is not None else None

        if not webapp_logo_file_id:
            raise NotFound("webapp logo is not found")

        try:
            generator, mimetype = FileService(db.engine).get_public_image_preview(
                webapp_logo_file_id,
            )
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return Response(generator, mimetype=mimetype)
