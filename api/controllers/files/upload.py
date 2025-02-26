from flask import request
from flask_restful import Resource, marshal_with  # type: ignore
from werkzeug.exceptions import Forbidden

import services
from controllers.console.wraps import setup_required
from controllers.files import api
from controllers.files.error import UnsupportedFileTypeError
from controllers.inner_api.plugin.wraps import get_user
from controllers.service_api.app.error import FileTooLargeError
from core.file.helpers import verify_plugin_file_signature
from fields.file_fields import file_fields
from services.file_service import FileService


class PluginUploadFileApi(Resource):
    @setup_required
    @marshal_with(file_fields)
    def post(self):
        # get file from request
        file = request.files["file"]

        timestamp = request.args.get("timestamp")
        nonce = request.args.get("nonce")
        sign = request.args.get("sign")
        tenant_id = request.args.get("tenant_id")
        if not tenant_id:
            raise Forbidden("Invalid request.")

        user_id = request.args.get("user_id")
        user = get_user(tenant_id, user_id)

        filename = file.filename
        mimetype = file.mimetype

        if not filename or not mimetype:
            raise Forbidden("Invalid request.")

        if not timestamp or not nonce or not sign:
            raise Forbidden("Invalid request.")

        if not verify_plugin_file_signature(
            filename=filename,
            mimetype=mimetype,
            tenant_id=tenant_id,
            user_id=user_id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
        ):
            raise Forbidden("Invalid request.")

        try:
            upload_file = FileService.upload_file(
                filename=filename,
                content=file.read(),
                mimetype=mimetype,
                user=user,
                source=None,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return upload_file, 201


api.add_resource(PluginUploadFileApi, "/files/upload/for-plugin")
