from mimetypes import guess_extension

from flask import request,current_app
from flask_restful import Resource, marshal_with
from werkzeug.exceptions import Forbidden
from werkzeug.utils import secure_filename
from core.file.safe_upload import (
    normalize_filename, split_suffixes, is_safe_suffixes,
    canonical_mimetype, sniff_ok,
)
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

        raw_filename = file.filename
        declared_mimetype = file.mimetype

        filename = normalize_filename(raw_filename or "")
        filename = secure_filename(filename)

        if not raw_filename or not declared_mimetype:
            raise Forbidden("Invalid request.")

        if not timestamp or not nonce or not sign:
            raise Forbidden("Invalid request.")

        if not verify_plugin_file_signature(
            filename=filename,
            mimetype=declared_mimetype,
            tenant_id=tenant_id,
            user_id=user_id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
        ):
            raise Forbidden("Invalid request.")
        base, suffixes = split_suffixes(filename)
        if not is_safe_suffixes(suffixes):
            raise UnsupportedFileTypeError()
        safe_ext = suffixes[-1]
        if not sniff_ok(file.stream, safe_ext):
            raise UnsupportedFileTypeError()
        server_mimetype = canonical_mimetype(safe_ext)
        if declared_mimetype and declared_mimetype.lower() != server_mimetype.lower():
            try:
                current_app.logger.warning(
                    "PluginUpload: mimetype mismatch: declared=%s server=%s tenant=%s user=%s name=%s",
                    declared_mimetype, server_mimetype, tenant_id, user_id, filename
                )
            except Exception:
                pass
        # Seek to the beginning of the file stream before processing
        try:
            file.stream.seek(0)
        except Exception:
            pass
        try:
            tool_file = ToolFileManager().create_file_by_raw(
                user_id=user.id,
                tenant_id=tenant_id,
                file_binary=file.read(),
                filename=filename,
                conversation_id=None,
            )

            extension = safe_ext or ".bin"
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
                "mime_type": server_mimetype,
                "extension": extension,
                "preview_url": preview_url,
            }

            return result, 201
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()


api.add_resource(PluginUploadFileApi, "/files/upload/for-plugin")
