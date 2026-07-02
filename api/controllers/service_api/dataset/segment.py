from typing import cast
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import select
from werkzeug.exceptions import NotFound

from configs import dify_config
from controllers.common.controller_schemas import ChildChunkCreatePayload, ChildChunkUpdatePayload
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import ProviderNotInitializeError
from controllers.service_api.wraps import (
    DatasetApiResource,
    cloud_edition_billing_knowledge_limit_check,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
)
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.segment_fields import (
    ChildChunkDetailResponse,
    ChildChunkListResponse,
    SegmentDetailResponse,
    SegmentResponse,
    segment_response_with_summary,
    segment_responses_with_summaries,
)
from graphon.model_runtime.entities.model_entities import ModelType
from libs.helper import dump_response
from libs.login import current_account_with_tenant
from models.dataset import Dataset, Document, DocumentSegment
from services.dataset_ref_service import DatasetRefService, SegmentRef
from services.dataset_service import DatasetService, DocumentService, SegmentService
from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs
from services.errors.chunk import ChildChunkDeleteIndexError, ChildChunkIndexingError
from services.errors.chunk import ChildChunkDeleteIndexError as ChildChunkDeleteIndexServiceError
from services.errors.chunk import ChildChunkIndexingError as ChildChunkIndexingServiceError
from services.summary_index_service import SummaryIndexService


class SegmentCreateItemPayload(BaseModel):
    content: str = Field(min_length=1, description="Chunk text content.")
    answer: str | None = Field(default=None, description="Answer content for QA mode.")
    keywords: list[str] | None = Field(default=None, description="Keywords for the chunk.")
    attachment_ids: list[str] | None = Field(default=None, description="Attachment file IDs.")

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Content is empty")
        return value


class SegmentCreatePayload(BaseModel):
    segments: list[SegmentCreateItemPayload] = Field(min_length=1, description="Array of chunk objects to create.")


class SegmentListQuery(BaseModel):
    limit: int = Field(default=20, ge=1, description="Number of items per page. Server caps at `100`.")
    page: int = Field(default=1, ge=1, description="Page number to retrieve.")
    status: list[str] = Field(
        default_factory=list,
        description="Filter chunks by indexing status, such as `completed`, `indexing`, or `error`.",
    )
    keyword: str | None = Field(default=None, description="Search keyword.")


class SegmentUpdatePayload(BaseModel):
    segment: SegmentUpdateArgs = Field(description="Chunk update payload.")


class ChildChunkListQuery(BaseModel):
    limit: int = Field(default=20, ge=1, description="Number of items per page. Server caps at `100`.")
    keyword: str | None = Field(default=None, description="Search keyword.")
    page: int = Field(default=1, ge=1, description="Page number to retrieve.")


class SegmentDocParams:
    DATASET_DOCUMENT = {"dataset_id": "Knowledge base ID.", "document_id": "Document ID."}
    DATASET_DOCUMENT_SEGMENT = {**DATASET_DOCUMENT, "segment_id": "Chunk ID."}
    DATASET_DOCUMENT_PARENT_SEGMENT = {**DATASET_DOCUMENT, "segment_id": "Chunk ID."}
    DATASET_DOCUMENT_CHILD_CHUNK = {**DATASET_DOCUMENT_PARENT_SEGMENT, "child_chunk_id": "Child chunk ID."}


class SegmentCreateListResponse(ResponseModel):
    data: list[SegmentResponse]
    doc_form: str


class SegmentListResponse(ResponseModel):
    data: list[SegmentResponse]
    doc_form: str
    total: int
    has_more: bool
    limit: int
    page: int


register_schema_models(
    service_api_ns,
    SegmentCreatePayload,
    SegmentCreateItemPayload,
    SegmentListQuery,
    SegmentUpdateArgs,
    SegmentUpdatePayload,
    ChildChunkCreatePayload,
    ChildChunkListQuery,
    ChildChunkUpdatePayload,
)
register_response_schema_models(
    service_api_ns,
    SegmentResponse,
    SegmentCreateListResponse,
    SegmentListResponse,
    SegmentDetailResponse,
    ChildChunkDetailResponse,
    ChildChunkListResponse,
)


def _get_segment_for_document(
    dataset: Dataset, document: Document, segment_id: str
) -> tuple[SegmentRef, DocumentSegment]:
    dataset_ref = DatasetRefService.create_dataset_ref(dataset)
    document_ref = DatasetRefService.create_document_ref(dataset_ref, document)
    if document_ref is None:
        raise NotFound("Document not found.")

    segment_ref = DatasetRefService.create_segment_ref(document_ref, segment_id)
    segment = SegmentService.get_segment_by_ref(segment_ref)
    if not segment:
        raise NotFound("Segment not found.")
    return segment_ref, segment


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments")
class SegmentApi(DatasetApiResource):
    """Resource for segments."""

    @service_api_ns.doc(
        summary="Create Chunks",
        description=(
            "Create one or more chunks within a document. Each chunk can include optional keywords and an "
            "answer field (for QA-mode documents)."
        ),
        tags=["Chunks"],
        responses={
            200: "Chunks created successfully.",
            404: "`not_found` : Document is not completed or is disabled.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[SegmentCreatePayload.__name__])
    @service_api_ns.doc("create_segments")
    @service_api_ns.doc(description="Create segments in a document")
    @service_api_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT)
    @service_api_ns.doc(
        responses={
            200: "Segments created successfully",
            400: "Bad request - segments data is missing",
            401: "Unauthorized - invalid API token",
            404: "Dataset or document not found",
        }
    )
    @service_api_ns.response(
        200,
        "Segments created successfully",
        service_api_ns.models[SegmentCreateListResponse.__name__],
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id: str, dataset_id: UUID, document_id: UUID):
        _, current_tenant_id = current_account_with_tenant()
        """Create single segment."""
        dataset_id_str = str(dataset_id)
        # check dataset
        dataset = db.session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")
        document_id_str = str(document_id)
        # check document
        document = DocumentService.get_document(dataset.id, document_id_str, session=db.session)
        if not document:
            raise NotFound("Document not found.")
        if document.indexing_status != "completed":
            raise NotFound("Document is not completed.")
        if not document.enabled:
            raise NotFound("Document is disabled.")
        # check embedding model setting
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            try:
                model_manager = ModelManager.for_tenant(tenant_id=current_tenant_id)
                model_manager.get_model_instance(
                    tenant_id=current_tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
        # validate args
        try:
            payload = SegmentCreatePayload.model_validate(service_api_ns.payload or {})
        except ValidationError as e:
            return {"error": str(e)}, 400
        segments_limit = dify_config.DATASET_MAX_SEGMENTS_PER_REQUEST
        if segments_limit > 0 and len(payload.segments) > segments_limit:
            raise ValueError(f"Exceeded maximum segments limit of {segments_limit}.")
        segment_items = [segment.model_dump(exclude_none=True) for segment in payload.segments]

        for args_item in segment_items:
            SegmentService.segment_create_args_validate(args_item, document)
        segments = cast(
            list[DocumentSegment], SegmentService.multi_create_segment(segment_items, document, dataset, db.session)
        )
        segment_ids = [segment.id for segment in segments]
        summaries: dict[str, str | None] = {}
        if segment_ids:
            summary_records = SummaryIndexService.get_segments_summaries(
                segment_ids=segment_ids, dataset_id=dataset_id_str
            )
            summaries = {chunk_id: record.summary_content for chunk_id, record in summary_records.items()}
        response = {
            "data": segment_responses_with_summaries(segments, summaries),
            "doc_form": document.doc_form,
        }
        return dump_response(SegmentCreateListResponse, response), 200

    @service_api_ns.doc(
        summary="List Chunks",
        description="Returns a paginated list of chunks within a document. Supports filtering by keyword and status.",
        tags=["Chunks"],
        responses={
            200: "List of chunks.",
        },
    )
    @service_api_ns.doc("list_segments")
    @service_api_ns.doc(description="List segments in a document")
    @service_api_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT)
    @service_api_ns.doc(params=query_params_from_model(SegmentListQuery))
    @service_api_ns.doc(
        responses={
            200: "Segments retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset or document not found",
        }
    )
    @service_api_ns.response(
        200,
        "Segments retrieved successfully",
        service_api_ns.models[SegmentListResponse.__name__],
    )
    def get(self, tenant_id: str, dataset_id: UUID, document_id: UUID):
        _, current_tenant_id = current_account_with_tenant()
        """Get segments."""
        # check dataset
        args = query_params_from_request(
            SegmentListQuery,
            list_fields=("status",),
        )
        page = args.page
        limit = args.limit
        dataset_id_str = str(dataset_id)
        dataset = db.session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")
        document_id_str = str(document_id)
        # check document
        document = DocumentService.get_document(dataset.id, document_id_str, session=db.session)
        if not document:
            raise NotFound("Document not found.")
        # check embedding model setting
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            try:
                model_manager = ModelManager.for_tenant(tenant_id=current_tenant_id)
                model_manager.get_model_instance(
                    tenant_id=current_tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)

        segments, total = SegmentService.get_segments(
            document_id=document_id_str,
            tenant_id=current_tenant_id,
            status_list=args.status,
            keyword=args.keyword,
            page=page,
            limit=limit,
        )
        segment_ids = [segment.id for segment in segments]
        summaries: dict[str, str | None] = {}
        if segment_ids:
            summary_records = SummaryIndexService.get_segments_summaries(
                segment_ids=segment_ids, dataset_id=dataset_id_str
            )
            summaries = {chunk_id: record.summary_content for chunk_id, record in summary_records.items()}

        response = {
            "data": segment_responses_with_summaries(segments, summaries),
            "doc_form": document.doc_form,
            "total": total,
            "has_more": len(segments) == limit,
            "limit": limit,
            "page": page,
        }

        return dump_response(SegmentListResponse, response), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>")
class DatasetSegmentApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Delete Chunk",
        description="Permanently delete a chunk from the document.",
        tags=["Chunks"],
        responses={
            204: "Success.",
        },
    )
    @service_api_ns.doc("delete_segment")
    @service_api_ns.doc(description="Delete a specific segment")
    @service_api_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_SEGMENT)
    @service_api_ns.doc(
        responses={
            204: "Segment deleted successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def delete(self, tenant_id: str, dataset_id: UUID, document_id: UUID, segment_id: UUID):
        current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        # check dataset
        dataset = db.session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        document_id_str = str(document_id)
        # check document
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=db.session)
        if not document:
            raise NotFound("Document not found.")
        segment_id_str = str(segment_id)
        _, segment = _get_segment_for_document(dataset, document, segment_id_str)
        SegmentService.delete_segment(segment, document, dataset, db.session)
        return "", 204

    @service_api_ns.doc(
        summary="Update Chunk",
        description="Update a chunk's content, keywords, or answer. Re-triggers indexing for the modified chunk.",
        tags=["Chunks"],
        responses={
            200: "Chunk updated successfully.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[SegmentUpdatePayload.__name__])
    @service_api_ns.doc("update_segment")
    @service_api_ns.doc(description="Update a specific segment")
    @service_api_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_SEGMENT)
    @service_api_ns.doc(
        responses={
            200: "Segment updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @service_api_ns.response(200, "Segment updated successfully", service_api_ns.models[SegmentDetailResponse.__name__])
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id: str, dataset_id: UUID, document_id: UUID, segment_id: UUID):
        _, current_tenant_id = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        # check dataset
        dataset = db.session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        document_id_str = str(document_id)
        # check document
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=db.session)
        if not document:
            raise NotFound("Document not found.")
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            # check embedding model setting
            try:
                model_manager = ModelManager.for_tenant(tenant_id=current_tenant_id)
                model_manager.get_model_instance(
                    tenant_id=current_tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
        segment_id_str = str(segment_id)
        _, segment = _get_segment_for_document(dataset, document, segment_id_str)

        payload = SegmentUpdatePayload.model_validate(service_api_ns.payload or {})

        updated_segment = SegmentService.update_segment(payload.segment, segment, document, dataset, db.session)
        summary = SummaryIndexService.get_segment_summary(segment_id=updated_segment.id, dataset_id=dataset_id_str)
        response = {
            "data": segment_response_with_summary(updated_segment, summary.summary_content if summary else None),
            "doc_form": document.doc_form,
        }
        return dump_response(SegmentDetailResponse, response), 200

    @service_api_ns.doc(
        summary="Get Chunk",
        description=(
            "Retrieve detailed information about a specific chunk, including its content, keywords, and "
            "indexing status."
        ),
        tags=["Chunks"],
        responses={
            200: "Chunk details.",
        },
    )
    @service_api_ns.doc("get_segment")
    @service_api_ns.doc(description="Get a specific segment by ID")
    @service_api_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_SEGMENT)
    @service_api_ns.doc(
        responses={
            200: "Segment retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @service_api_ns.response(
        200,
        "Segment retrieved successfully",
        service_api_ns.models[SegmentDetailResponse.__name__],
    )
    def get(self, tenant_id: str, dataset_id: UUID, document_id: UUID, segment_id: UUID):
        current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        # check dataset
        dataset = db.session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        document_id_str = str(document_id)
        # check document
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=db.session)
        if not document:
            raise NotFound("Document not found.")
        segment_id_str = str(segment_id)
        _, segment = _get_segment_for_document(dataset, document, segment_id_str)

        summary = SummaryIndexService.get_segment_summary(segment_id=segment.id, dataset_id=dataset_id_str)
        response = {
            "data": segment_response_with_summary(segment, summary.summary_content if summary else None),
            "doc_form": document.doc_form,
        }
        return dump_response(SegmentDetailResponse, response), 200


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks"
)
class ChildChunkApi(DatasetApiResource):
    """Resource for child chunks."""

    @service_api_ns.doc(
        summary="Create Child Chunk",
        description="Create a child chunk under the specified segment.",
        tags=["Chunks"],
        responses={
            200: "Child chunk created successfully.",
            400: "`invalid_param` : Create child chunk index failed.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[ChildChunkCreatePayload.__name__])
    @service_api_ns.doc("create_child_chunk")
    @service_api_ns.doc(description="Create a new child chunk for a segment")
    @service_api_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_PARENT_SEGMENT)
    @service_api_ns.doc(
        responses={
            200: "Child chunk created successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @service_api_ns.response(
        200,
        "Child chunk created successfully",
        service_api_ns.models[ChildChunkDetailResponse.__name__],
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id: str, dataset_id: UUID, document_id: UUID, segment_id: UUID):
        _, current_tenant_id = current_account_with_tenant()
        """Create child chunk."""
        dataset_id_str = str(dataset_id)
        # check dataset
        dataset = db.session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")

        document_id_str = str(document_id)
        # check document
        document = DocumentService.get_document(dataset.id, document_id_str, session=db.session)
        if not document:
            raise NotFound("Document not found.")

        segment_id_str = str(segment_id)
        _, segment = _get_segment_for_document(dataset, document, segment_id_str)

        # check embedding model setting
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            try:
                model_manager = ModelManager.for_tenant(tenant_id=current_tenant_id)
                model_manager.get_model_instance(
                    tenant_id=current_tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)

        # validate args
        payload = ChildChunkCreatePayload.model_validate(service_api_ns.payload or {})

        try:
            child_chunk = SegmentService.create_child_chunk(payload.content, segment, document, dataset, db.session)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))

        return dump_response(ChildChunkDetailResponse, {"data": child_chunk}), 200

    @service_api_ns.doc(
        summary="List Child Chunks",
        description="Returns a paginated list of child chunks under a specific parent chunk.",
        tags=["Chunks"],
        responses={
            200: "List of child chunks.",
        },
    )
    @service_api_ns.doc("list_child_chunks")
    @service_api_ns.doc(description="List child chunks for a segment")
    @service_api_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_PARENT_SEGMENT)
    @service_api_ns.doc(params=query_params_from_model(ChildChunkListQuery))
    @service_api_ns.doc(
        responses={
            200: "Child chunks retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @service_api_ns.response(
        200,
        "Child chunks retrieved successfully",
        service_api_ns.models[ChildChunkListResponse.__name__],
    )
    def get(self, tenant_id: str, dataset_id: UUID, document_id: UUID, segment_id: UUID):
        current_account_with_tenant()
        """Get child chunks."""
        dataset_id_str = str(dataset_id)
        # check dataset
        dataset = db.session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")

        document_id_str = str(document_id)
        # check document
        document = DocumentService.get_document(dataset.id, document_id_str, session=db.session)
        if not document:
            raise NotFound("Document not found.")

        segment_id_str = str(segment_id)
        _get_segment_for_document(dataset, document, segment_id_str)

        args = query_params_from_request(ChildChunkListQuery)

        page = args.page
        limit = min(args.limit, 100)
        keyword = args.keyword

        child_chunks = SegmentService.get_child_chunks(
            segment_id_str, document_id_str, dataset_id_str, page, limit, keyword
        )

        response = {
            "data": child_chunks.items,
            "total": child_chunks.total,
            "total_pages": child_chunks.pages,
            "page": page,
            "limit": limit,
        }
        return dump_response(ChildChunkListResponse, response), 200


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks/<uuid:child_chunk_id>"
)
class DatasetChildChunkApi(DatasetApiResource):
    """Resource for updating child chunks."""

    @service_api_ns.doc(
        summary="Delete Child Chunk",
        description="Permanently delete a child chunk from its parent chunk.",
        tags=["Chunks"],
        responses={
            204: "Success.",
            400: "`invalid_param` : Delete child chunk index failed.",
        },
    )
    @service_api_ns.doc("delete_child_chunk")
    @service_api_ns.doc(description="Delete a specific child chunk")
    @service_api_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_CHILD_CHUNK)
    @service_api_ns.doc(
        responses={
            204: "Child chunk deleted successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, segment, or child chunk not found",
        }
    )
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def delete(self, tenant_id: str, dataset_id: UUID, document_id: UUID, segment_id: UUID, child_chunk_id: UUID):
        current_account_with_tenant()
        """Delete child chunk."""
        dataset_id_str = str(dataset_id)
        # check dataset
        dataset = db.session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")

        document_id_str = str(document_id)
        # check document
        document = DocumentService.get_document(dataset.id, document_id_str, session=db.session)
        if not document:
            raise NotFound("Document not found.")

        segment_id_str = str(segment_id)
        segment_ref, _ = _get_segment_for_document(dataset, document, segment_id_str)

        child_chunk_id_str = str(child_chunk_id)
        # check child chunk
        child_chunk = SegmentService.get_child_chunk_by_segment_ref(child_chunk_id_str, segment_ref)
        if not child_chunk:
            raise NotFound("Child chunk not found.")

        try:
            SegmentService.delete_child_chunk(child_chunk, dataset, db.session)
        except ChildChunkDeleteIndexServiceError as e:
            raise ChildChunkDeleteIndexError(str(e))

        return "", 204

    @service_api_ns.doc(
        summary="Update Child Chunk",
        description="Update the content of an existing child chunk.",
        tags=["Chunks"],
        responses={
            200: "Child chunk updated successfully.",
            400: "`invalid_param` : Update child chunk index failed.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[ChildChunkUpdatePayload.__name__])
    @service_api_ns.doc("update_child_chunk")
    @service_api_ns.doc(description="Update a specific child chunk")
    @service_api_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_CHILD_CHUNK)
    @service_api_ns.doc(
        responses={
            200: "Child chunk updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, segment, or child chunk not found",
        }
    )
    @service_api_ns.response(
        200,
        "Child chunk updated successfully",
        service_api_ns.models[ChildChunkDetailResponse.__name__],
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def patch(self, tenant_id: str, dataset_id: UUID, document_id: UUID, segment_id: UUID, child_chunk_id: UUID):
        current_account_with_tenant()
        """Update child chunk."""
        dataset_id_str = str(dataset_id)
        # check dataset
        dataset = db.session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")

        document_id_str = str(document_id)
        # get document
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=db.session)
        if not document:
            raise NotFound("Document not found.")

        segment_id_str = str(segment_id)
        segment_ref, segment = _get_segment_for_document(dataset, document, segment_id_str)

        child_chunk_id_str = str(child_chunk_id)
        # get child chunk
        child_chunk = SegmentService.get_child_chunk_by_segment_ref(child_chunk_id_str, segment_ref)
        if not child_chunk:
            raise NotFound("Child chunk not found.")

        # validate args
        payload = ChildChunkUpdatePayload.model_validate(service_api_ns.payload or {})

        try:
            child_chunk = SegmentService.update_child_chunk(
                payload.content, child_chunk, segment, document, dataset, db.session
            )
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))

        return dump_response(ChildChunkDetailResponse, {"data": child_chunk}), 200
