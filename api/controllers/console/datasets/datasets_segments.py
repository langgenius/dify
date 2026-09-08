from typing import Literal, Never
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.controller_schemas import ChildChunkCreatePayload, ChildChunkUpdatePayload
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import (
    ChildChunkDeleteIndexError,
    ChildChunkIndexingError,
    InvalidActionError,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    cloud_edition_billing_knowledge_limit_check,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.segment_fields import (
    ChildChunkDetailResponse,
    ChildChunkListResponse,
    ChildChunkResponse,
    SegmentDetailResponse,
    SegmentResponse,
)
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.entities.knowledge_entities.segments import ChildChunkUpdateArgs
from services.knowledge.segments.application import (
    ChildChunkDeleteIndexApplicationError,
    ChildChunkIndexingApplicationError,
    ChildChunkListFilter,
    ChildChunkNotFoundError,
    SegmentBatchImportDispatchError,
    SegmentBatchImportNotFoundError,
    SegmentDatasetModelUnavailableError,
    SegmentDatasetNotFoundError,
    SegmentDocumentIndexingError,
    SegmentDocumentNotFoundError,
    SegmentEmbeddingModelUnavailableError,
    SegmentInvalidFileTypeError,
    SegmentListFilter,
    SegmentNotFoundError,
    SegmentPermissionDeniedError,
    SegmentStatusUpdateError,
    SegmentUploadFileNotFoundError,
)

_DATASET_EDIT_ROLES = frozenset(
    {
        TenantAccountRole.OWNER,
        TenantAccountRole.ADMIN,
        TenantAccountRole.EDITOR,
        TenantAccountRole.DATASET_OPERATOR,
    }
)


class SegmentListQuery(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    status: list[str] = Field(default_factory=list)
    hit_count_gte: int | None = None
    enabled: str = Field(default="all")
    keyword: str | None = None
    page: int = Field(default=1, ge=1)


class SegmentIdListQuery(BaseModel):
    segment_id: list[str] = Field(default_factory=list, description="Segment IDs")


class ChildChunkListQuery(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    keyword: str | None = None
    page: int = Field(default=1, ge=1)


class SegmentCreatePayload(BaseModel):
    content: str
    answer: str | None = None
    keywords: list[str] | None = None
    attachment_ids: list[str] | None = None


class SegmentUpdatePayload(BaseModel):
    content: str
    answer: str | None = None
    keywords: list[str] | None = None
    regenerate_child_chunks: bool = False
    attachment_ids: list[str] | None = None
    summary: str | None = None  # Summary content for summary index


class BatchImportPayload(BaseModel):
    upload_file_id: str


class SegmentBatchImportStatusResponse(ResponseModel):
    job_id: str
    job_status: str


class ConsoleSegmentListResponse(ResponseModel):
    data: list[SegmentResponse]
    limit: int
    total: int
    total_pages: int
    page: int


class ChildChunkBatchUpdateResponse(ResponseModel):
    data: list[ChildChunkResponse]


class ChildChunkBatchUpdatePayload(BaseModel):
    chunks: list[ChildChunkUpdateArgs]


class SegmentDocParams:
    DATASET_DOCUMENT = {"dataset_id": "Dataset ID", "document_id": "Document ID"}
    DATASET_DOCUMENT_ACTION = {**DATASET_DOCUMENT, "action": "Action"}
    DATASET_DOCUMENT_SEGMENT = {**DATASET_DOCUMENT, "segment_id": "Segment ID"}
    DATASET_DOCUMENT_PARENT_SEGMENT = {**DATASET_DOCUMENT, "segment_id": "Parent segment ID"}
    DATASET_DOCUMENT_CHILD_CHUNK = {**DATASET_DOCUMENT_PARENT_SEGMENT, "child_chunk_id": "Child chunk ID"}


register_schema_models(
    console_ns,
    SegmentListQuery,
    SegmentIdListQuery,
    ChildChunkListQuery,
    SegmentCreatePayload,
    SegmentUpdatePayload,
    BatchImportPayload,
    ChildChunkCreatePayload,
    ChildChunkUpdatePayload,
    ChildChunkBatchUpdatePayload,
    ChildChunkUpdateArgs,
)
register_response_schema_models(
    console_ns,
    SegmentResponse,
    ConsoleSegmentListResponse,
    SegmentDetailResponse,
    ChildChunkDetailResponse,
    ChildChunkListResponse,
    ChildChunkBatchUpdateResponse,
    SegmentBatchImportStatusResponse,
    SimpleResultResponse,
)


def _raise_segment_error(error: Exception) -> Never:
    if isinstance(error, SegmentDatasetNotFoundError):
        raise NotFound("Dataset not found.") from error
    if isinstance(error, SegmentDocumentNotFoundError):
        raise NotFound("Document not found.") from error
    if isinstance(error, SegmentNotFoundError):
        raise NotFound("Segment not found.") from error
    if isinstance(error, ChildChunkNotFoundError):
        raise NotFound("Child chunk not found.") from error
    if isinstance(error, SegmentUploadFileNotFoundError):
        raise NotFound("UploadFile not found.") from error
    if isinstance(error, SegmentPermissionDeniedError):
        raise Forbidden(str(error)) from error
    if isinstance(error, SegmentEmbeddingModelUnavailableError):
        raise ProviderNotInitializeError(str(error)) from error
    if isinstance(error, SegmentDatasetModelUnavailableError):
        raise ValueError(str(error)) from error
    if isinstance(error, (SegmentDocumentIndexingError, SegmentStatusUpdateError)):
        raise InvalidActionError(str(error)) from error
    if isinstance(error, SegmentInvalidFileTypeError):
        raise ValueError(str(error)) from error
    if isinstance(error, ChildChunkIndexingApplicationError):
        raise ChildChunkIndexingError(str(error)) from error
    if isinstance(error, ChildChunkDeleteIndexApplicationError):
        raise ChildChunkDeleteIndexError(str(error)) from error
    raise error


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments")
class DatasetDocumentSegmentListApi(Resource):
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT)
    @console_ns.doc(params=query_params_from_model(SegmentListQuery))
    @console_ns.response(200, "Segments retrieved successfully", console_ns.models[ConsoleSegmentListResponse.__name__])
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_READONLY,
    )
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        args = query_params_from_request(SegmentListQuery, list_fields=("status",))
        try:
            result = application_services().knowledge.segments.list_segments(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                query=SegmentListFilter(
                    page=args.page,
                    limit=args.limit,
                    statuses=tuple(args.status),
                    hit_count_gte=args.hit_count_gte,
                    enabled=args.enabled,
                    keyword=args.keyword,
                ),
            )
        except Exception as error:
            _raise_segment_error(error)
        response = {
            "data": result.items,
            "limit": result.limit,
            "total": result.total,
            "total_pages": result.total_pages,
            "page": result.page,
        }
        return dump_response(ConsoleSegmentListResponse, response), 200

    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_EDIT,
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT)
    @console_ns.doc(params=query_params_from_model(SegmentIdListQuery))
    @console_ns.response(204, "Segments deleted successfully")
    def delete(
        self,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
    ):
        args = query_params_from_request(SegmentIdListQuery, list_fields=("segment_id",))
        try:
            application_services().knowledge.segments.delete_segments(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_ids=args.segment_id,
            )
        except Exception as error:
            _raise_segment_error(error)
        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segment/<string:action>")
class DatasetDocumentSegmentApi(Resource):
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_ACTION)
    @console_ns.doc(params=query_params_from_model(SegmentIdListQuery))
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_EDIT,
    )
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    def patch(
        self,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
        action: Literal["enable", "disable"],
    ):
        if action not in ("enable", "disable"):
            raise InvalidActionError()
        args = query_params_from_request(SegmentIdListQuery, list_fields=("segment_id",))
        try:
            application_services().knowledge.segments.change_segment_status(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_ids=args.segment_id,
                action=action,
            )
        except Exception as error:
            _raise_segment_error(error)
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segment")
class DatasetDocumentSegmentAddApi(Resource):
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT)
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_EDIT,
    )
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[SegmentCreatePayload.__name__])
    @console_ns.response(200, "Segment created successfully", console_ns.models[SegmentDetailResponse.__name__])
    @model_validate(SegmentCreatePayload)
    def post(
        self,
        req_data: SegmentCreatePayload,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
    ):
        try:
            result = application_services().knowledge.segments.create_segment(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                values=req_data.model_dump(exclude_none=True),
            )
        except Exception as error:
            _raise_segment_error(error)
        response = {
            "data": result.data,
            "doc_form": result.doc_form,
        }
        return dump_response(SegmentDetailResponse, response), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>")
class DatasetDocumentSegmentUpdateApi(Resource):
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_SEGMENT)
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_EDIT,
    )
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[SegmentUpdatePayload.__name__])
    @console_ns.response(200, "Segment updated successfully", console_ns.models[SegmentDetailResponse.__name__])
    @model_validate(SegmentUpdatePayload)
    def patch(
        self,
        req_data: SegmentUpdatePayload,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
    ):
        try:
            result = application_services().knowledge.segments.update_segment(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_id=str(segment_id),
                values=req_data.model_dump(exclude_none=True),
            )
        except Exception as error:
            _raise_segment_error(error)
        response = {
            "data": result.data,
            "doc_form": result.doc_form,
        }
        return dump_response(SegmentDetailResponse, response), 200

    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_EDIT,
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_SEGMENT)
    @console_ns.response(204, "Segment deleted successfully")
    def delete(
        self,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
    ):
        try:
            application_services().knowledge.segments.delete_segment(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_id=str(segment_id),
            )
        except Exception as error:
            _raise_segment_error(error)
        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/batch_import")
class DatasetDocumentSegmentBatchImportApi(Resource):
    @console_ns.response(200, "Batch import started", console_ns.models[SegmentBatchImportStatusResponse.__name__])
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_EDIT,
    )
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[BatchImportPayload.__name__])
    @model_validate(BatchImportPayload)
    def post(
        self,
        req_data: BatchImportPayload,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
    ):
        try:
            result = application_services().knowledge.segments.start_batch_import(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                upload_file_id=req_data.upload_file_id,
            )
        except SegmentBatchImportDispatchError as error:
            return {"error": str(error)}, 500
        except Exception as error:
            _raise_segment_error(error)
        return dump_response(SegmentBatchImportStatusResponse, result), 200


@console_ns.route("/datasets/batch_import_status/<uuid:job_id>")
class DatasetDocumentSegmentBatchImportStatusApi(Resource):
    @console_ns.response(200, "Batch import status", console_ns.models[SegmentBatchImportStatusResponse.__name__])
    @console_account_admission()
    def get(self, _request_context: RequestContext, job_id: UUID):
        try:
            result = application_services().knowledge.segments.get_batch_import_status(str(job_id))
        except SegmentBatchImportNotFoundError as error:
            raise ValueError(str(error)) from error
        return dump_response(SegmentBatchImportStatusResponse, result), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks")
class ChildChunkAddApi(Resource):
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_PARENT_SEGMENT)
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_EDIT,
    )
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[ChildChunkCreatePayload.__name__])
    @console_ns.response(200, "Child chunk created successfully", console_ns.models[ChildChunkDetailResponse.__name__])
    @model_validate(ChildChunkCreatePayload)
    def post(
        self,
        req_data: ChildChunkCreatePayload,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
    ):
        try:
            child_chunk = application_services().knowledge.segments.create_child_chunk(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_id=str(segment_id),
                content=req_data.content,
            )
        except Exception as error:
            _raise_segment_error(error)
        return dump_response(ChildChunkDetailResponse, {"data": child_chunk}), 200

    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_PARENT_SEGMENT)
    @console_ns.doc(params=query_params_from_model(ChildChunkListQuery))
    @console_ns.response(200, "Child chunks retrieved successfully", console_ns.models[ChildChunkListResponse.__name__])
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_READONLY,
    )
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID, segment_id: UUID):
        args = query_params_from_request(ChildChunkListQuery, use_defaults_for_malformed_ints=True)
        try:
            result = application_services().knowledge.segments.list_child_chunks(
                workspace_id=request_context.active_workspace_id,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_id=str(segment_id),
                query=ChildChunkListFilter(page=args.page, limit=args.limit, keyword=args.keyword),
            )
        except Exception as error:
            _raise_segment_error(error)
        response = {
            "data": result.items,
            "total": result.total,
            "total_pages": result.total_pages,
            "page": result.page,
            "limit": result.limit,
        }
        return dump_response(ChildChunkListResponse, response), 200

    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_EDIT,
    )
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_PARENT_SEGMENT)
    @console_ns.response(
        200,
        "Child chunks updated successfully",
        console_ns.models[ChildChunkBatchUpdateResponse.__name__],
    )
    @console_ns.expect(console_ns.models[ChildChunkBatchUpdatePayload.__name__])
    @model_validate(ChildChunkBatchUpdatePayload)
    def patch(
        self,
        req_data: ChildChunkBatchUpdatePayload,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
    ):
        try:
            child_chunks = application_services().knowledge.segments.update_child_chunks(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_id=str(segment_id),
                chunks=req_data.chunks,
            )
        except Exception as error:
            _raise_segment_error(error)
        return dump_response(ChildChunkBatchUpdateResponse, {"data": child_chunks}), 200


@console_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks/<uuid:child_chunk_id>"
)
class ChildChunkUpdateApi(Resource):
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_EDIT,
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_CHILD_CHUNK)
    @console_ns.response(204, "Child chunk deleted successfully")
    def delete(
        self,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
        child_chunk_id: UUID,
    ):
        try:
            application_services().knowledge.segments.delete_child_chunk(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_id=str(segment_id),
                child_chunk_id=str(child_chunk_id),
            )
        except Exception as error:
            _raise_segment_error(error)
        return "", 204

    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.DATASET,
        rbac_permission=RBACPermission.DATASET_EDIT,
    )
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_CHILD_CHUNK)
    @console_ns.expect(console_ns.models[ChildChunkUpdatePayload.__name__])
    @console_ns.response(200, "Child chunk updated successfully", console_ns.models[ChildChunkDetailResponse.__name__])
    @model_validate(ChildChunkUpdatePayload)
    def patch(
        self,
        req_data: ChildChunkUpdatePayload,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
        child_chunk_id: UUID,
    ):
        try:
            child_chunk = application_services().knowledge.segments.update_child_chunk(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_id=str(segment_id),
                child_chunk_id=str(child_chunk_id),
                content=req_data.content,
            )
        except Exception as error:
            _raise_segment_error(error)
        return dump_response(ChildChunkDetailResponse, {"data": child_chunk}), 200
