import urllib.parse

from flask_restful import marshal_with, reqparse

from controllers.common import helpers
from controllers.web.wraps import WebApiResource
from core.file import helpers as file_helpers
from core.helper import ssrf_proxy
from fields.file_fields import file_fields_with_signed_url, remote_file_info_fields
from services.file_service import FileService


class RemoteFileInfoApi(WebApiResource):
    @marshal_with(remote_file_info_fields)
    def get(self, url):
        decoded_url = urllib.parse.unquote(url)
        try:
            response = ssrf_proxy.head(decoded_url)
            return {
                "file_type": response.headers.get("Content-Type", "application/octet-stream"),
                "file_length": int(response.headers.get("Content-Length", -1)),
            }
        except Exception as e:
            return {"error": str(e)}, 400


class RemoteFileUploadApi(WebApiResource):
    @marshal_with(file_fields_with_signed_url)
    def post(self, app_model, end_user):  # Add app_model and end_user parameters
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
            upload_file = FileService.upload_file(
                filename=file_info.filename,
                content=content,
                mimetype=file_info.mimetype,
                user=end_user,  # Use end_user instead of current_user
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
