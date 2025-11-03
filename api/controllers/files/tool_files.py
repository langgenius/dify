from urllib.parse import quote

from flask import Response
from flask_restx import Resource, reqparse
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.errors import UnsupportedFileTypeError
from controllers.files import files_ns
from core.tools.signature import verify_tool_file_signature
from core.tools.tool_file_manager import ToolFileManager
from extensions.ext_database import db as global_db


@files_ns.route("/tools/<uuid:file_id>.<string:extension>")
class ToolFileApi(Resource):
    @files_ns.doc("get_tool_file")
    @files_ns.doc(description="Download a tool file by ID using signed parameters")
    @files_ns.doc(
        params={
            "file_id": "Tool file identifier",
            "extension": "Expected file extension",
            "timestamp": "Unix timestamp used in the signature",
            "nonce": "Random string used in the signature",
            "sign": "HMAC signature verifying the request",
            "as_attachment": "Whether to download the file as an attachment",
        }
    )
    @files_ns.doc(
        responses={
            200: "Tool file stream returned successfully",
            403: "Forbidden - invalid signature",
            404: "File not found",
            415: "Unsupported file type",
        }
    )
    def get(self, file_id, extension):
        file_id = str(file_id)

        parser = (
            reqparse.RequestParser()
            .add_argument("timestamp", type=str, required=True, location="args")
            .add_argument("nonce", type=str, required=True, location="args")
            .add_argument("sign", type=str, required=True, location="args")
            .add_argument("as_attachment", type=bool, required=False, default=False, location="args")
        )

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
