from flask import request
from flask_restful import marshal_with

import services
from controllers.service_api import api
from controllers.service_api.app import create_or_update_end_user_for_user_id
from controllers.service_api.app.error import (
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.service_api.wraps import AppApiResource
from fields.file_fields import file_fields
from services.file_service import FileService


class FileApi(AppApiResource):

    @marshal_with(file_fields)
    def post(self, app_model, end_user):

        file = request.files['file']
        user_args = request.form.get('user')

        if end_user is None and user_args is not None:
            end_user = create_or_update_end_user_for_user_id(app_model, user_args)

        # check file
        if 'file' not in request.files:
            raise NoFileUploadedError()

        if not file.mimetype:
            raise UnsupportedFileTypeError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        try:
            upload_file = FileService.upload_file(file, end_user)
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return upload_file, 201


api.add_resource(FileApi, '/files/upload')
