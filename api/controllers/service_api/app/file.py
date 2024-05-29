from flask import request
from flask_restful import Resource, marshal_with

import services
from controllers.service_api import api
from controllers.service_api.app.error import (
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from fields.file_fields import file_fields
from models.model import App, EndUser
from services.file_service import FileService


class FileApi(Resource):

    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.FORM))
    @marshal_with(file_fields)
    def post(self, app_model: App, end_user: EndUser):

        file = request.files['file']

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
