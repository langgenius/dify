from urllib.parse import quote

from flask import Response
from flask_restful import Resource, reqparse
from werkzeug.exceptions import Forbidden, NotFound

from controllers.files import api
from controllers.files.error import UnsupportedFileTypeError
from core.tools.signature import verify_tool_file_signature
from core.tools.tool_file_manager import ToolFileManager
from models import db as global_db


class ToolFilePreviewApi(Resource):
    def get(self, file_id, extension):
        file_id = str(file_id)

        parser = reqparse.RequestParser()

        parser.add_argument("timestamp", type=str, required=True, location="args")
        parser.add_argument("nonce", type=str, required=True, location="args")
        parser.add_argument("sign", type=str, required=True, location="args")
        parser.add_argument("as_attachment", type=bool, required=False, default=False, location="args")

        args = parser.parse_args()
        if not verify_tool_file_signature(
            file_id=file_id, timestamp=args["timestamp"], nonce=args["nonce"], sign=args["sign"]
        ):
            raise Forbidden("Invalid request.")

        try:
            tool_file_manager = ToolFileManager(engine=global_db.engine)
            stream, tool_file = tool_file_manager.get_file_generator_by_tool_file_id(
                file_id,
            )

            if not stream or not tool_file:
                raise NotFound("file is not found")
        except Exception:
            raise UnsupportedFileTypeError()

        response = Response(
            stream,
            mimetype=tool_file.mimetype,
            direct_passthrough=True,
            headers={},
        )
        if tool_file.size > 0:
            response.headers["Content-Length"] = str(tool_file.size)
        if args["as_attachment"]:
            encoded_filename = quote(tool_file.name)
            response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"

        return response


api.add_resource(ToolFilePreviewApi, "/files/tools/<uuid:file_id>.<string:extension>")
