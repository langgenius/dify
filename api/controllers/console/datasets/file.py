import urllib.parse

from flask import request
from flask_login import current_user
from flask_restful import Resource, marshal_with, reqparse

import services
from configs import dify_config
from constants import DOCUMENT_EXTENSIONS
from controllers.console import api
from controllers.console.datasets.error import (
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from core.helper import ssrf_proxy
from fields.file_fields import file_fields, remote_file_info_fields, upload_config_fields
from libs.login import login_required
from services.file_service import FileService

PREVIEW_WORDS_LIMIT = 3000


class FileApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(upload_config_fields)
    def get(self):
        return {
            "file_size_limit": dify_config.UPLOAD_FILE_SIZE_LIMIT,
            "batch_count_limit": dify_config.UPLOAD_FILE_BATCH_LIMIT,
            "image_file_size_limit": dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
            "video_file_size_limit": dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
            "audio_file_size_limit": dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
        }, 200

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(file_fields)
    @cloud_edition_billing_resource_check("documents")
    def post(self):
        # get file from request
        file = request.files["file"]

        parser = reqparse.RequestParser()
        parser.add_argument("source", type=str, required=False, location="args")
        source = parser.parse_args().get("source")

        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()
        try:
            upload_file = FileService.upload_file(file=file, user=current_user, source=source)
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
        return {"content": text}


class FileSupportTypeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        return {"allowed_extensions": DOCUMENT_EXTENSIONS}


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


api.add_resource(FileApi, "/files/upload")
api.add_resource(FilePreviewApi, "/files/<uuid:file_id>/preview")
api.add_resource(FileSupportTypeApi, "/files/support-type")
api.add_resource(RemoteFileInfoApi, "/remote-files/<path:url>")
