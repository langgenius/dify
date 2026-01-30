"""
Console app annotation endpoints (FastOpenAPI).

Notes:
- These routes are registered on `controllers.fastopenapi.console_router` and are intended for the
  FastOpenAPI PoC router mounted at `/console/api`.
- FastOpenAPI's current Flask adapter always returns `jsonify(result), status_code`, so endpoints
  should return Pydantic models / dicts / lists (not Flask `Response` objects). This means we
  can't set custom response headers (e.g. for export responses) from these handlers.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal, TypeAlias
from uuid import UUID

from flask import abort, request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import BadRequest, NotFound

from controllers.common.errors import NoFileUploadedError, TooManyFilesError
from controllers.console.wraps import (
    account_initialization_required,
    annotation_import_concurrency_limit,
    annotation_import_rate_limit,
    cloud_edition_billing_resource_check,
    edit_permission_required,
    setup_required,
)
from controllers.fastopenapi import console_router
from extensions.ext_redis import redis_client
from libs.helper import uuid_value
from libs.login import login_required
from services.annotation_service import AppAnnotationService

if TYPE_CHECKING:
    from models.model import AppAnnotationHitHistory, MessageAnnotation
else:
    AppAnnotationHitHistory: TypeAlias = Any
    MessageAnnotation: TypeAlias = Any


def _to_timestamp(value: datetime | int | None) -> int | None:
    if isinstance(value, datetime):
        return int(value.timestamp())
    if isinstance(value, int):
        return value
    return None


def _normalize_job_id(value: Any) -> str:
    if isinstance(value, (bytes, bytearray)):
        return value.decode()
    return str(value)


def _get_single_uploaded_file(*, field_name: str) -> FileStorage:
    if field_name not in request.files:
        raise NoFileUploadedError()
    if len(request.files) > 1:
        raise TooManyFilesError()
    return request.files[field_name]


class AnnotationReplyPayload(BaseModel):
    score_threshold: float = Field(..., description="Score threshold for annotation matching")
    embedding_provider_name: str = Field(..., description="Embedding provider name")
    embedding_model_name: str = Field(..., description="Embedding model name")


class AnnotationSettingUpdatePayload(BaseModel):
    score_threshold: float = Field(..., description="Score threshold")


class AnnotationListQuery(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number")
    limit: int = Field(default=20, ge=1, description="Page size")
    keyword: str = Field(default="", description="Search keyword")


class CreateAnnotationPayload(BaseModel):
    message_id: str | None = Field(default=None, description="Message ID")
    question: str | None = Field(default=None, description="Question text")
    answer: str | None = Field(default=None, description="Answer text")
    content: str | None = Field(default=None, description="Content text")
    annotation_reply: dict[str, Any] | None = Field(default=None, description="Annotation reply data")

    @field_validator("message_id")
    @classmethod
    def validate_message_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


class UpdateAnnotationPayload(BaseModel):
    question: str | None = None
    answer: str | None = None
    content: str | None = None
    annotation_reply: dict[str, Any] | None = None


class DeleteAnnotationsPayload(BaseModel):
    annotation_ids: list[str] | None = Field(
        default=None,
        description="Annotation IDs to delete in batch. If omitted, clears all annotations.",
    )


class PaginationQuery(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number")
    limit: int = Field(default=20, ge=1, description="Page size")


class ResponseModel(BaseModel):
    """
    FastOpenAPI serializes Pydantic models via `model_dump()` without `exclude_none=True`.
    Default to excluding `None` fields to keep legacy response shapes (e.g. return only `{"enabled": false}`).
    """

    model_config = ConfigDict(
        extra="ignore",
        populate_by_name=True,
        serialize_by_alias=True,
        protected_namespaces=(),
    )

    @model_serializer(mode="wrap")
    def _serialize(self, handler):
        def prune_none(value: Any) -> Any:
            if isinstance(value, dict):
                return {k: prune_none(v) for k, v in value.items() if v is not None}
            if isinstance(value, list):
                return [prune_none(v) for v in value]
            return value

        return prune_none(handler(self))


class EmbeddingModel(ResponseModel):
    embedding_provider_name: str | None = Field(default=None, description="Embedding provider name")
    embedding_model_name: str | None = Field(default=None, description="Embedding model name")


class AnnotationSettingResponse(ResponseModel):
    enabled: bool = Field(description="Whether annotation reply is enabled")
    id: str | None = Field(default=None, description="Annotation setting ID")
    score_threshold: float | None = Field(default=None, description="Score threshold")
    embedding_model: EmbeddingModel | None = Field(default=None, description="Embedding model configuration")


class AnnotationJobStatusResponse(ResponseModel):
    job_id: str = Field(description="Job ID")
    job_status: str = Field(description="Job status")
    error_msg: str | None = Field(default=None, description="Error message, if any")


class AnnotationBatchImportResponse(ResponseModel):
    job_id: str | None = Field(default=None, description="Job ID")
    job_status: str | None = Field(default=None, description="Job status")
    record_count: int | None = Field(default=None, description="Imported record count, if applicable")
    error_msg: str | None = Field(default=None, description="Error message, if any")


class AnnotationItem(ResponseModel):
    id: str = Field(description="Annotation ID")
    question: str = Field(description="Annotation question")
    answer: str = Field(description="Annotation answer/content")
    hit_count: int = Field(description="Hit count")
    created_at: int = Field(description="Created timestamp (seconds)")


class AnnotationListResponse(ResponseModel):
    data: list[AnnotationItem] = Field(description="Annotations")
    has_more: bool = Field(description="Whether there are more results")
    limit: int = Field(description="Page size")
    total: int = Field(description="Total count")
    page: int = Field(description="Current page")


class AnnotationExportResponse(ResponseModel):
    data: list[AnnotationItem] = Field(description="Annotations")


class DeleteAnnotationsResponse(ResponseModel):
    deleted_count: int | None = Field(default=None, description="Deleted annotations count (batch delete only)")
    result: Literal["success"] | None = Field(default=None, description='Result (clear-all only, e.g. "success")')


class AnnotationHitHistoryItem(ResponseModel):
    id: str = Field(description="Hit history ID")
    source: str = Field(description="Source")
    score: float = Field(description="Match score")
    question: str = Field(description="User question")
    created_at: int = Field(description="Created timestamp (seconds)")
    match: str = Field(description="Matched annotation question")
    response: str = Field(description="Matched annotation response/content")


class AnnotationHitHistoryListResponse(ResponseModel):
    data: list[AnnotationHitHistoryItem] = Field(description="Hit histories")
    has_more: bool = Field(description="Whether there are more results")
    limit: int = Field(description="Page size")
    total: int = Field(description="Total count")
    page: int = Field(description="Current page")


def _annotation_to_response(annotation: MessageAnnotation) -> AnnotationItem:
    created_at = _to_timestamp(annotation.created_at)
    if created_at is None:
        created_at = 0
    return AnnotationItem(
        id=str(annotation.id),
        question=str(annotation.question or ""),
        answer=str(annotation.content or ""),
        hit_count=int(annotation.hit_count or 0),
        created_at=created_at,
    )


def _hit_history_to_response(hit: AppAnnotationHitHistory) -> AnnotationHitHistoryItem:
    created_at = _to_timestamp(hit.created_at)
    if created_at is None:
        created_at = 0
    return AnnotationHitHistoryItem(
        id=str(hit.id),
        source=str(hit.source or ""),
        score=float(hit.score or 0.0),
        question=str(hit.question or ""),
        created_at=created_at,
        match=str(getattr(hit, "annotation_question", "") or ""),
        response=str(getattr(hit, "annotation_content", "") or ""),
    )


@console_router.post(
    "/apps/<uuid:app_id>/annotation-reply/<string:action>",
    response_model=AnnotationJobStatusResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@cloud_edition_billing_resource_check("annotation")
@edit_permission_required
def annotation_reply_action(
    app_id: UUID,
    action: Literal["enable", "disable"],
    payload: AnnotationReplyPayload,
) -> AnnotationJobStatusResponse:
    app_id_str = str(app_id)
    if action == "enable":
        result = AppAnnotationService.enable_app_annotation(payload, app_id_str)
    else:
        result = AppAnnotationService.disable_app_annotation(app_id_str)

    job_id = _normalize_job_id(result.get("job_id"))
    return AnnotationJobStatusResponse(job_id=job_id, job_status=str(result.get("job_status", "")))


@console_router.get(
    "/apps/<uuid:app_id>/annotation-setting",
    response_model=AnnotationSettingResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@edit_permission_required
def get_annotation_setting(app_id: UUID) -> AnnotationSettingResponse:
    result = AppAnnotationService.get_app_annotation_setting_by_app_id(str(app_id))
    embedding_model = result.get("embedding_model") if isinstance(result, dict) else None
    if isinstance(embedding_model, dict) and not embedding_model:
        result["embedding_model"] = None
    return AnnotationSettingResponse.model_validate(result)


@console_router.post(
    "/apps/<uuid:app_id>/annotation-settings/<uuid:annotation_setting_id>",
    response_model=AnnotationSettingResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@edit_permission_required
def update_annotation_setting(
    app_id: UUID,
    annotation_setting_id: UUID,
    payload: AnnotationSettingUpdatePayload,
) -> AnnotationSettingResponse:
    result = AppAnnotationService.update_app_annotation_setting(
        str(app_id),
        str(annotation_setting_id),
        payload,
    )
    embedding_model = result.get("embedding_model") if isinstance(result, dict) else None
    if isinstance(embedding_model, dict) and not embedding_model:
        result["embedding_model"] = None
    return AnnotationSettingResponse.model_validate(result)


@console_router.get(
    "/apps/<uuid:app_id>/annotation-reply/<string:action>/status/<uuid:job_id>",
    response_model=AnnotationJobStatusResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@cloud_edition_billing_resource_check("annotation")
@edit_permission_required
def get_annotation_reply_action_status(app_id: UUID, job_id: UUID, action: str) -> AnnotationJobStatusResponse:
    _ = app_id
    job_id_str = str(job_id)
    app_annotation_job_key = f"{action}_app_annotation_job_{job_id_str}"
    cache_result = redis_client.get(app_annotation_job_key)
    if cache_result is None:
        raise NotFound("The job does not exist.")

    job_status = cache_result.decode()
    error_msg = ""
    if job_status == "error":
        app_annotation_error_key = f"{action}_app_annotation_error_{job_id_str}"
        error_msg_bytes = redis_client.get(app_annotation_error_key)
        if error_msg_bytes is not None:
            error_msg = error_msg_bytes.decode()

    return AnnotationJobStatusResponse(job_id=job_id_str, job_status=job_status, error_msg=error_msg)


@console_router.get(
    "/apps/<uuid:app_id>/annotations",
    response_model=AnnotationListResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@edit_permission_required
def list_annotations(app_id: UUID, query: AnnotationListQuery) -> AnnotationListResponse:
    annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(
        str(app_id),
        query.page,
        query.limit,
        query.keyword,
    )
    items = [_annotation_to_response(annotation) for annotation in annotation_list]
    return AnnotationListResponse(
        data=items,
        has_more=len(items) == query.limit,
        limit=query.limit,
        total=total or 0,
        page=query.page,
    )


@console_router.post(
    "/apps/<uuid:app_id>/annotations",
    response_model=AnnotationItem,
    tags=["console"],
    status_code=201,
)
@setup_required
@login_required
@account_initialization_required
@cloud_edition_billing_resource_check("annotation")
@edit_permission_required
def create_annotation(app_id: UUID, payload: CreateAnnotationPayload) -> AnnotationItem:
    annotation = AppAnnotationService.up_insert_app_annotation_from_message(payload, str(app_id))
    return _annotation_to_response(annotation)


@console_router.delete(
    "/apps/<uuid:app_id>/annotations",
    tags=["console"],
    status_code=204,
)
@setup_required
@login_required
@account_initialization_required
@edit_permission_required
def delete_annotations(app_id: UUID, payload: DeleteAnnotationsPayload) -> DeleteAnnotationsResponse:
    app_id_str = str(app_id)

    annotation_ids = payload.annotation_ids
    if annotation_ids is not None:
        if len(annotation_ids) == 0 or any(not annotation_id.strip() for annotation_id in annotation_ids):
            raise BadRequest("annotation_ids must be a non-empty list of IDs.")
        result = AppAnnotationService.delete_app_annotations_in_batch(app_id_str, annotation_ids)
        return DeleteAnnotationsResponse.model_validate(result)

    result = AppAnnotationService.clear_all_annotations(app_id_str)
    return DeleteAnnotationsResponse.model_validate(result)


@console_router.get(
    "/apps/<uuid:app_id>/annotations/export",
    response_model=AnnotationExportResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@edit_permission_required
def export_annotations(app_id: UUID) -> AnnotationExportResponse:
    annotation_list = AppAnnotationService.export_annotation_list_by_app_id(str(app_id))
    return AnnotationExportResponse(data=[_annotation_to_response(annotation) for annotation in annotation_list])


@console_router.post(
    "/apps/<uuid:app_id>/annotations/<uuid:annotation_id>",
    response_model=AnnotationItem,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@cloud_edition_billing_resource_check("annotation")
@edit_permission_required
def update_annotation(app_id: UUID, annotation_id: UUID, payload: UpdateAnnotationPayload) -> AnnotationItem:
    annotation = AppAnnotationService.update_app_annotation_directly(payload, str(app_id), str(annotation_id))
    return _annotation_to_response(annotation)


@console_router.delete(
    "/apps/<uuid:app_id>/annotations/<uuid:annotation_id>",
    tags=["console"],
    status_code=204,
)
@setup_required
@login_required
@account_initialization_required
@edit_permission_required
def delete_annotation(app_id: UUID, annotation_id: UUID) -> dict[str, str] | None:
    AppAnnotationService.delete_app_annotation(str(app_id), str(annotation_id))
    return {"result": "success"}


@console_router.post(
    "/apps/<uuid:app_id>/annotations/batch-import",
    response_model=AnnotationBatchImportResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@cloud_edition_billing_resource_check("annotation")
@annotation_import_rate_limit
@annotation_import_concurrency_limit
@edit_permission_required
def batch_import_annotations(app_id: UUID) -> AnnotationBatchImportResponse:
    from configs import dify_config

    file = _get_single_uploaded_file(field_name="file")
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise BadRequest("Invalid file type. Only CSV files are allowed")

    file.seek(0, 2)
    file_size = file.tell()
    file.seek(0)

    max_size_bytes = dify_config.ANNOTATION_IMPORT_FILE_SIZE_LIMIT * 1024 * 1024
    if file_size > max_size_bytes:
        abort(
            413,
            f"File size exceeds maximum limit of {dify_config.ANNOTATION_IMPORT_FILE_SIZE_LIMIT}MB. "
            f"Please reduce the file size and try again.",
        )

    if file_size == 0:
        raise BadRequest("The uploaded file is empty")

    result = AppAnnotationService.batch_import_app_annotations(str(app_id), file)
    if "job_id" in result:
        result["job_id"] = _normalize_job_id(result.get("job_id"))
    return AnnotationBatchImportResponse.model_validate(result)


@console_router.get(
    "/apps/<uuid:app_id>/annotations/batch-import-status/<uuid:job_id>",
    response_model=AnnotationJobStatusResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@cloud_edition_billing_resource_check("annotation")
@edit_permission_required
def get_batch_import_status(app_id: UUID, job_id: UUID) -> AnnotationJobStatusResponse:
    _ = app_id
    job_id_str = str(job_id)
    indexing_cache_key = f"app_annotation_batch_import_{job_id_str}"
    cache_result = redis_client.get(indexing_cache_key)
    if cache_result is None:
        raise NotFound("The job does not exist.")

    job_status = cache_result.decode()
    error_msg = ""
    if job_status == "error":
        indexing_error_msg_key = f"app_annotation_batch_import_error_msg_{job_id_str}"
        error_msg_bytes = redis_client.get(indexing_error_msg_key)
        if error_msg_bytes is not None:
            error_msg = error_msg_bytes.decode()

    return AnnotationJobStatusResponse(job_id=job_id_str, job_status=job_status, error_msg=error_msg)


@console_router.get(
    "/apps/<uuid:app_id>/annotations/<uuid:annotation_id>/hit-histories",
    response_model=AnnotationHitHistoryListResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
@edit_permission_required
def list_annotation_hit_histories(
    app_id: UUID,
    annotation_id: UUID,
    query: PaginationQuery,
) -> AnnotationHitHistoryListResponse:
    hit_histories, total = AppAnnotationService.get_annotation_hit_histories(
        str(app_id),
        str(annotation_id),
        query.page,
        query.limit,
    )
    items = [_hit_history_to_response(hit) for hit in hit_histories]
    return AnnotationHitHistoryListResponse(
        data=items,
        has_more=len(items) == query.limit,
        limit=query.limit,
        total=total or 0,
        page=query.page,
    )
