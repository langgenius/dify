from typing import Literal, cast
from uuid import UUID

from flask import request
from pydantic import BaseModel
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
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    setup_required,
)
from controllers.fastopenapi import console_router
from extensions.ext_database import db
from fields.file_fields import FileResponse, UploadConfig
from libs.login import current_account_with_tenant, login_required
from services.file_service import FileService

PREVIEW_WORDS_LIMIT = 3000


@console_router.get(
    "/files/upload",
    response_model=UploadConfig,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def get_upload_config() -> UploadConfig:
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
    return config


@console_router.post(
    "/files/upload",
    response_model=FileResponse,
    tags=["console"],
    status_code=201,
)
@setup_required
@login_required
@account_initialization_required
@cloud_edition_billing_resource_check("documents")
def upload_file() -> FileResponse:
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

    return FileResponse.model_validate(upload_file, from_attributes=True)


class Preview(BaseModel):
    content: str


@console_router.get(
    "/files/<uuid:file_id>/preview",
    tags=["console"],
    response_model=Preview,
)
@setup_required
@login_required
@account_initialization_required
def get_file_preview(file_id: UUID) -> Preview:
    text = cast(str, FileService(db.engine).get_file_preview(str(file_id)))
    return Preview(content=text)


class SupportType(BaseModel):
    allowed_extensions: list[str]


@console_router.get(
    "/files/support-type",
    tags=["console"],
    response_model=SupportType,
)
@setup_required
@login_required
@account_initialization_required
def get_file_support_types() -> SupportType:
    return SupportType(allowed_extensions=list(DOCUMENT_EXTENSIONS))
