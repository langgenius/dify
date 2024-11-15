from flask_restful import Resource, reqparse

from controllers.files import api


class PluginFilePreviewApi(Resource):
    def get(self, file_id: str, file_type: str):
        parser = reqparse.RequestParser()

        parser.add_argument("timestamp", type=str, required=True, location="args")
        parser.add_argument("nonce", type=str, required=True, location="args")
        parser.add_argument("sign", type=str, required=True, location="args")
        parser.add_argument("as_attachment", type=bool, required=False, default=False, location="args")

        args = parser.parse_args()


api.add_resource(PluginFilePreviewApi, "/files/<path:file_id>/<path:file_type>/plugin-file-preview")
