from flask import request
from flask_login import current_user
from flask_restful import Resource, marshal_with

import services
from configs import dify_config
from controllers.console import api
from controllers.console.datasets.error import (
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from fields.file_fields import file_fields, upload_config_fields
from libs.login import login_required
from services.file_service import ALLOWED_EXTENSIONS, UNSTRUCTURED_ALLOWED_EXTENSIONS, FileService

PREVIEW_WORDS_LIMIT = 3000


class FileApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(upload_config_fields)
    def get(self):
        file_size_limit = dify_config.UPLOAD_FILE_SIZE_LIMIT
        batch_count_limit = dify_config.UPLOAD_FILE_BATCH_LIMIT
        image_file_size_limit = dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT
        return {
            'file_size_limit': file_size_limit,
            'batch_count_limit': batch_count_limit,
            'image_file_size_limit': image_file_size_limit
        }, 200

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(file_fields)
    @cloud_edition_billing_resource_check(resource='documents')
    def post(self):

        # get file from request
        file = request.files['file']

        # check file
        if 'file' not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()
        try:
            upload_file = FileService.upload_file(file, current_user)
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


class FileSupportTypeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        etl_type = dify_config.ETL_TYPE
        allowed_extensions = UNSTRUCTURED_ALLOWED_EXTENSIONS if etl_type == 'Unstructured' else ALLOWED_EXTENSIONS
        return {'allowed_extensions': allowed_extensions}


api.add_resource(FileApi, '/files/upload')
api.add_resource(FilePreviewApi, '/files/<uuid:file_id>/preview')
api.add_resource(FileSupportTypeApi, '/files/support-type')
