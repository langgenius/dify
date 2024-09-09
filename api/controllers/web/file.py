from flask import request
from flask_restful import marshal_with

import services
from controllers.web import api
from controllers.web.error import FileTooLargeError, NoFileUploadedError, TooManyFilesError, UnsupportedFileTypeError
from controllers.web.wraps import WebApiResource
from fields.file_fields import file_fields
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


api.add_resource(FileApi, "/files/upload")
