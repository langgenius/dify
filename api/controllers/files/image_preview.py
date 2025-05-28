from urllib.parse import quote

from flask import Response, request
from flask_restful import Resource, reqparse
from werkzeug.exceptions import NotFound

import services
from controllers.files import api
from controllers.files.error import UnsupportedFileTypeError
from services.account_service import TenantService
from services.file_service import FileService


class ImagePreviewApi(Resource):
    """
    Deprecated
    """

    def get(self, file_id):
        file_id = str(file_id)

        timestamp = request.args.get("timestamp")
        nonce = request.args.get("nonce")
        sign = request.args.get("sign")

        if not timestamp or not nonce or not sign:
            return {"content": "Invalid request."}, 400

        try:
            generator, mimetype = FileService.get_image_preview(
                file_id=file_id,
                timestamp=timestamp,
                nonce=nonce,
                sign=sign,
            )
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return Response(generator, mimetype=mimetype)


class FilePreviewApi(Resource):
    def get(self, file_id):
        file_id = str(file_id)

        parser = reqparse.RequestParser()
        parser.add_argument("timestamp", type=str, required=True, location="args")
        parser.add_argument("nonce", type=str, required=True, location="args")
        parser.add_argument("sign", type=str, required=True, location="args")
        parser.add_argument("as_attachment", type=bool, required=False, default=False, location="args")

        args = parser.parse_args()

        if not args["timestamp"] or not args["nonce"] or not args["sign"]:
            return {"content": "Invalid request."}, 400

        try:
            generator, upload_file = FileService.get_file_generator_by_file_id(
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


class WorkspaceWebappLogoApi(Resource):
    def get(self, workspace_id):
        workspace_id = str(workspace_id)

        custom_config = TenantService.get_custom_config(workspace_id)
        webapp_logo_file_id = custom_config.get("replace_webapp_logo") if custom_config is not None else None

        if not webapp_logo_file_id:
            raise NotFound("webapp logo is not found")

        try:
            generator, mimetype = FileService.get_public_image_preview(
                webapp_logo_file_id,
            )
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return Response(generator, mimetype=mimetype)


api.add_resource(ImagePreviewApi, "/files/<uuid:file_id>/image-preview")
api.add_resource(FilePreviewApi, "/files/<uuid:file_id>/file-preview")
api.add_resource(WorkspaceWebappLogoApi, "/files/workspaces/<uuid:workspace_id>/webapp-logo")
