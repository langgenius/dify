from mimetypes import guess_extension

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
from core.tools.tool_file_manager import ToolFileManager
from fields.file_fields import file_fields


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
            tool_file.mime_type = mimetype
            tool_file.extension = extension
            tool_file.preview_url = preview_url
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return tool_file, 201


api.add_resource(PluginUploadFileApi, "/files/upload/for-plugin")
