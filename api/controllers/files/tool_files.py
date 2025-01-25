from flask import Response
from flask_restful import Resource, reqparse  # type: ignore
from werkzeug.exceptions import Forbidden, NotFound

from controllers.files import api
from controllers.files.error import UnsupportedFileTypeError
from core.tools.tool_file_manager import ToolFileManager


class ToolFilePreviewApi(Resource):
    def get(self, file_id, extension):
        file_id = str(file_id)

        parser = reqparse.RequestParser()

        parser.add_argument("timestamp", type=str, required=True, location="args")
        parser.add_argument("nonce", type=str, required=True, location="args")
        parser.add_argument("sign", type=str, required=True, location="args")
        parser.add_argument("as_attachment", type=bool, required=False, default=False, location="args")

        args = parser.parse_args()

        if not ToolFileManager.verify_file(
            file_id=file_id,
            timestamp=args["timestamp"],
            nonce=args["nonce"],
            sign=args["sign"],
        ):
            raise Forbidden("Invalid request.")

        try:
            stream, tool_file = ToolFileManager.get_file_generator_by_tool_file_id(
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
            response.headers["Content-Disposition"] = f"attachment; filename={tool_file.name}"

        return response


api.add_resource(ToolFilePreviewApi, "/files/tools/<uuid:file_id>.<string:extension>")
