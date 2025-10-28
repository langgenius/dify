from typing import Literal

from flask import request
from flask_restx import Resource, marshal_with
from werkzeug.exceptions import Forbidden

import services
from configs import dify_config
from constants import DOCUMENT_EXTENSIONS
from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    setup_required,
)
from extensions.ext_database import db
from fields.file_fields import file_fields, upload_config_fields
from libs.login import current_account_with_tenant, login_required
from services.file_service import FileService

from . import console_ns

PREVIEW_WORDS_LIMIT = 3000


@console_ns.route("/files/upload")
class FileApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(upload_config_fields)
    def get(self):
        return {
            "file_size_limit": dify_config.UPLOAD_FILE_SIZE_LIMIT,
            "batch_count_limit": dify_config.UPLOAD_FILE_BATCH_LIMIT,
            "file_upload_limit": dify_config.BATCH_UPLOAD_LIMIT,
            "image_file_size_limit": dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
            "video_file_size_limit": dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
            "audio_file_size_limit": dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
            "workflow_file_upload_limit": dify_config.WORKFLOW_FILE_UPLOAD_LIMIT,
        }, 200

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(file_fields)
    @cloud_edition_billing_resource_check("documents")
    def post(self):
        current_user, _ = current_account_with_tenant()
        source_str = request.form.get("source")
        source: Literal["datasets"] | None = "datasets" if source_str == "datasets" else None

        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()
        file = request.files["file"]

        if not file.filename:
            raise FilenameNotExistsError
        if source == "datasets" and not current_user.is_dataset_editor:
            raise Forbidden()

        if source not in ("datasets", None):
            source = None

        try:
            upload_file = FileService(db.engine).upload_file(
                filename=file.filename,
                content=file.read(),
                mimetype=file.mimetype,
                user=current_user,
                source=source,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return upload_file, 201


@console_ns.route("/files/<uuid:file_id>/preview")
class FilePreviewApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, file_id):
        file_id = str(file_id)
        text = FileService(db.engine).get_file_preview(file_id)
        return {"content": text}


@console_ns.route("/files/support-type")
class FileSupportTypeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        return {"allowed_extensions": list(DOCUMENT_EXTENSIONS)}
