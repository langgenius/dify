import urllib.parse
from typing import cast

from flask_login import current_user
from flask_restful import Resource, marshal_with, reqparse

from controllers.common import helpers
from core.file import helpers as file_helpers
from core.helper import ssrf_proxy
from fields.file_fields import file_fields_with_signed_url, remote_file_info_fields
from models.account import Account
from services.file_service import FileService


class RemoteFileInfoApi(Resource):
    @marshal_with(remote_file_info_fields)
    def get(self, url):
        decoded_url = urllib.parse.unquote(url)
        try:
            response = ssrf_proxy.head(decoded_url)
            return {
                "file_type": response.headers.get("Content-Type", "application/octet-stream"),
                "file_length": int(response.headers.get("Content-Length", 0)),
            }
        except Exception as e:
            return {"error": str(e)}, 400


class RemoteFileUploadApi(Resource):
    @marshal_with(file_fields_with_signed_url)
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("url", type=str, required=True, help="URL is required")
        args = parser.parse_args()

        url = args["url"]

        response = ssrf_proxy.head(url)
        response.raise_for_status()

        file_info = helpers.guess_file_info_from_response(response)

        if not FileService.is_file_size_within_limit(extension=file_info.extension, file_size=file_info.size):
            return {"error": "File size exceeded"}, 400

        response = ssrf_proxy.get(url)
        response.raise_for_status()
        content = response.content

        try:
            user = cast(Account, current_user)
            upload_file = FileService.upload_file(
                filename=file_info.filename,
                content=content,
                mimetype=file_info.mimetype,
                user=user,
                source_url=url,
            )
        except Exception as e:
            return {"error": str(e)}, 400

        return {
            "id": upload_file.id,
            "name": upload_file.name,
            "size": upload_file.size,
            "extension": upload_file.extension,
            "url": file_helpers.get_signed_file_url(upload_file_id=upload_file.id),
            "mime_type": upload_file.mime_type,
            "created_by": upload_file.created_by,
            "created_at": upload_file.created_at,
        }, 201
