import urllib.parse

from flask import request
from flask_restful import marshal_with

import services
from controllers.web import api
from controllers.web.error import FileTooLargeError, NoFileUploadedError, TooManyFilesError, UnsupportedFileTypeError
from controllers.web.wraps import WebApiResource
from core.helper import ssrf_proxy
from fields.file_fields import file_fields, remote_file_info_fields
from services.file_service import FileService


class FileApi(WebApiResource):
    @marshal_with(file_fields)
    def post(self, app_model, end_user):
        # get file from request
        file = request.files["file"]

        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()
        try:
            upload_file = FileService.upload_file(file, end_user)
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return upload_file, 201


class RemoteFileInfoApi(WebApiResource):
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


api.add_resource(FileApi, "/files/upload")
api.add_resource(RemoteFileInfoApi, "/remote-files/<path:url>")
