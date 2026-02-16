from typing import Literal

from flask import request
from flask_restx import Resource
from werkzeug.exceptions import Forbidden

import services
from configs import dify_config
from constants import DOCUMENT_EXTENSIONS
from controllers.common.errors import (
    BlockedFileExtensionError,
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import register_schema_models
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    setup_required,
)
from extensions.ext_database import db
from fields.file_fields import FileResponse, UploadConfig
from libs.login import current_account_with_tenant, login_required
from services.file_service import FileService

from . import console_ns

register_schema_models(console_ns, UploadConfig, FileResponse)

PREVIEW_WORDS_LIMIT = 3000


@console_ns.route("/files/upload")
class FileApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[UploadConfig.__name__])
    def get(self):
        config = UploadConfig(
            file_size_limit=dify_config.UPLOAD_FILE_SIZE_LIMIT,
            batch_count_limit=dify_config.UPLOAD_FILE_BATCH_LIMIT,
            file_upload_limit=dify_config.BATCH_UPLOAD_LIMIT,
            image_file_size_limit=dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
            video_file_size_limit=dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
            audio_file_size_limit=dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
            workflow_file_upload_limit=dify_config.WORKFLOW_FILE_UPLOAD_LIMIT,
            image_file_batch_limit=dify_config.IMAGE_FILE_BATCH_LIMIT,
            single_chunk_attachment_limit=dify_config.SINGLE_CHUNK_ATTACHMENT_LIMIT,
            attachment_image_file_size_limit=dify_config.ATTACHMENT_IMAGE_FILE_SIZE_LIMIT,
        )
        return config.model_dump(mode="json"), 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("documents")
    @console_ns.response(201, "File uploaded successfully", console_ns.models[FileResponse.__name__])
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
        except services.errors.file.BlockedFileExtensionError as blocked_extension_error:
            raise BlockedFileExtensionError(blocked_extension_error.description)

        response = FileResponse.model_validate(upload_file, from_attributes=True)
        return response.model_dump(mode="json"), 201


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
