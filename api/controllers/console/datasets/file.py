from cachetools import TTLCache
from flask import request, current_app

import services
from libs.login import login_required
from flask_restful import Resource, marshal_with

from controllers.console import api
from controllers.console.datasets.error import NoFileUploadedError, TooManyFilesError, FileTooLargeError, \
    UnsupportedFileTypeError

from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from fields.file_fields import upload_config_fields, file_fields

from services.file_service import FileService

cache = TTLCache(maxsize=None, ttl=30)

ALLOWED_EXTENSIONS = ['txt', 'markdown', 'md', 'pdf', 'html', 'htm', 'xlsx', 'docx', 'csv']
PREVIEW_WORDS_LIMIT = 3000


class FileApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(upload_config_fields)
    def get(self):
        file_size_limit = current_app.config.get("UPLOAD_FILE_SIZE_LIMIT")
        batch_count_limit = current_app.config.get("UPLOAD_FILE_BATCH_LIMIT")
        return {
            'file_size_limit': file_size_limit,
            'batch_count_limit': batch_count_limit
        }, 200

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(file_fields)
    def post(self):

        # get file from request
        file = request.files['file']

        # check file
        if 'file' not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()
        try:
            upload_file = FileService.upload_file(file)
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return upload_file, 201


class FilePreviewApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, file_id):
        file_id = str(file_id)
        text = FileService.get_file_preview(file_id)
        return {'content': text}


api.add_resource(FileApi, '/files/upload')
api.add_resource(FilePreviewApi, '/files/<uuid:file_id>/preview')
