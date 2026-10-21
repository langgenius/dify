from typing import Never
from uuid import UUID

from controllers.common.controller_schemas import ChildChunkCreatePayload, ChildChunkUpdatePayload
from controllers.common.errors import ForbiddenError, NotFoundError
from controllers.common.fields import ErrorMessageResponse
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import ProviderNotInitializeError
from controllers.service_api.dataset.error import InvalidActionError
from controllers.service_api.flask_admission import DatasetApiResource, dataset_admission
from extensions.ext_application_services import application_services
from fields.segment_fields import (
    ChildChunkDetailResponse,
    ChildChunkListResponse,
    SegmentDetailResponse,
    SegmentResponse,
)
from fields.service_api.segment import (
    ChildChunkListQuery,
    SegmentCreateItemPayload,
    SegmentCreateListResponse,
    SegmentCreatePayload,
    SegmentListQuery,
    SegmentListResponse,
    SegmentUpdatePayload,
)
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from services.errors.chunk import ChildChunkIndexingError
from services.knowledge.entities.segments import SegmentUpdateArgs
from services.knowledge.segments.application import (
    ChildChunkIndexingApplicationError,
    ChildChunkNotFoundError,
    SegmentDatasetModelUnavailableError,
    SegmentDatasetNotFoundError,
    SegmentDocumentDisabledError,
    SegmentDocumentIndexingError,
    SegmentDocumentNotCompletedError,
    SegmentDocumentNotFoundError,
    SegmentEmbeddingModelUnavailableError,
    SegmentNotFoundError,
    SegmentPermissionDeniedError,
)
from services.knowledge.segments.contracts import ChildChunkListFilter, SegmentListFilter


class SegmentDocParams:
    DATASET_DOCUMENT = {"dataset_id": "Knowledge base ID.", "document_id": "Document ID."}
    DATASET_DOCUMENT_SEGMENT = {**DATASET_DOCUMENT, "segment_id": "Chunk ID."}
    DATASET_DOCUMENT_PARENT_SEGMENT = {**DATASET_DOCUMENT, "segment_id": "Chunk ID."}
    DATASET_DOCUMENT_CHILD_CHUNK = {**DATASET_DOCUMENT_PARENT_SEGMENT, "child_chunk_id": "Child chunk ID."}


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
    ErrorMessageResponse,
    SegmentResponse,
    SegmentCreateListResponse,
    SegmentListResponse,
    SegmentDetailResponse,
    ChildChunkDetailResponse,
    ChildChunkListResponse,
)


def _raise_segment_error(error: Exception) -> Never:
    if isinstance(error, SegmentDatasetNotFoundError):
        raise NotFoundError(description="Dataset not found.") from error
    if isinstance(error, SegmentDocumentNotFoundError):
        raise NotFoundError(description="Document not found.") from error
    if isinstance(error, SegmentDocumentNotCompletedError):
        raise NotFoundError(description="Document is not completed.") from error
    if isinstance(error, SegmentDocumentDisabledError):
        raise NotFoundError(description="Document is disabled.") from error
    if isinstance(error, SegmentNotFoundError):
        raise NotFoundError(description="Segment not found.") from error
    if isinstance(error, ChildChunkNotFoundError):
        raise NotFoundError(description="Child chunk not found.") from error
    if isinstance(error, SegmentPermissionDeniedError):
        raise ForbiddenError(description=str(error)) from error
    if isinstance(error, SegmentDatasetModelUnavailableError):
        raise ValueError(str(error)) from error
    if isinstance(error, SegmentDocumentIndexingError):
        raise InvalidActionError(str(error)) from error
    raise error


def _raise_embedding_error(error: Exception) -> Never:
    if isinstance(error, SegmentEmbeddingModelUnavailableError):
        raise ProviderNotInitializeError(str(error)) from error
    _raise_segment_error(error)


def _raise_child_chunk_write_error(error: Exception) -> Never:
    if isinstance(error, ChildChunkIndexingApplicationError):
        raise ChildChunkIndexingError(str(error)) from error
    _raise_segment_error(error)


def _raise_child_chunk_create_error(error: Exception) -> Never:
    if isinstance(error, ChildChunkIndexingApplicationError):
        raise ChildChunkIndexingError(str(error)) from error
    _raise_embedding_error(error)


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments")
class SegmentApi(DatasetApiResource):
    """Resource for segments."""

    @error_responses(ProviderNotInitializeError)
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
    @service_api_ns.response(
        400,
        "Bad request - segments data is missing",
        service_api_ns.models[ErrorMessageResponse.__name__],
    )
    @dataset_admission(rate_limit=True, billing_resources=("vector_space",), require_paid_segments=True)
    def post(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        try:
            payload = SegmentCreatePayload.model_validate(service_api_ns.payload or {})
        except ValueError as error:
            return {"error": str(error)}, 400
        try:
            result = application_services().knowledge.segments.create_segments(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                values=[item.model_dump(exclude_none=True) for item in payload.segments],
            )
        except Exception as error:
            _raise_embedding_error(error)
        return dump_response(
            SegmentCreateListResponse,
            {"data": [item.data for item in result], "doc_form": result[0].doc_form},
        ), 200

    @error_responses(ProviderNotInitializeError)
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
            400: "Bad request - embedding model is not configured",
            401: "Unauthorized - invalid API token",
            404: "Dataset or document not found",
        }
    )
    @service_api_ns.response(
        200,
        "Segments retrieved successfully",
        service_api_ns.models[SegmentListResponse.__name__],
    )
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        args = query_params_from_request(
            SegmentListQuery,
            list_fields=("status",),
            use_defaults_for_malformed_ints=True,
        )
        try:
            result = application_services().knowledge.segments.list_segments_requiring_embedding_model(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                query=SegmentListFilter(
                    page=args.page,
                    limit=args.limit,
                    statuses=tuple(args.status),
                    keyword=args.keyword,
                ),
            )
        except Exception as error:
            _raise_embedding_error(error)
        response = {
            "data": result.items,
            "doc_form": result.doc_form,
            "total": result.total,
            "has_more": result.page * result.limit < result.total,
            "limit": result.limit,
            "page": result.page,
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
            400: "Bad request - invalid dataset model state or concurrent deletion",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @dataset_admission(rate_limit=True)
    def delete(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID, segment_id: UUID):
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

    @error_responses(InvalidActionError, ProviderNotInitializeError)
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
            400: "Bad request - invalid segment or embedding model configuration",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @service_api_ns.response(200, "Segment updated successfully", service_api_ns.models[SegmentDetailResponse.__name__])
    @dataset_admission(rate_limit=True, billing_resources=("vector_space",))
    @model_validate(SegmentUpdatePayload)
    def post(
        self,
        payload: SegmentUpdatePayload,
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
                values=payload.segment.model_dump(exclude_none=True, exclude_unset=True),
            )
        except Exception as error:
            _raise_embedding_error(error)
        return dump_response(SegmentDetailResponse, {"data": result.data, "doc_form": result.doc_form}), 200

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
            400: "Bad request - invalid dataset model configuration",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @service_api_ns.response(
        200,
        "Segment retrieved successfully",
        service_api_ns.models[SegmentDetailResponse.__name__],
    )
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID, segment_id: UUID):
        try:
            result = application_services().knowledge.segments.get_segment(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_id=str(segment_id),
            )
        except Exception as error:
            _raise_segment_error(error)
        return dump_response(SegmentDetailResponse, {"data": result.data, "doc_form": result.doc_form}), 200


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks"
)
class ChildChunkApi(DatasetApiResource):
    """Resource for child chunks."""

    @error_responses(ProviderNotInitializeError)
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
        200, "Child chunk created successfully", service_api_ns.models[ChildChunkDetailResponse.__name__]
    )
    @dataset_admission(rate_limit=True, billing_resources=("vector_space",), require_paid_segments=True)
    @model_validate(ChildChunkCreatePayload)
    def post(
        self,
        payload: ChildChunkCreatePayload,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
    ):
        try:
            result = application_services().knowledge.segments.create_child_chunk(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_id=str(segment_id),
                content=payload.content,
            )
        except Exception as error:
            _raise_child_chunk_create_error(error)
        return dump_response(ChildChunkDetailResponse, {"data": result}), 200

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
        200, "Child chunks retrieved successfully", service_api_ns.models[ChildChunkListResponse.__name__]
    )
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID, segment_id: UUID):
        args = query_params_from_request(ChildChunkListQuery, use_defaults_for_malformed_ints=True)
        try:
            result = application_services().knowledge.segments.list_child_chunks(
                request_context,
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
    @dataset_admission(rate_limit=True, require_paid_segments=True)
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
            _raise_child_chunk_write_error(error)
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
        200, "Child chunk updated successfully", service_api_ns.models[ChildChunkDetailResponse.__name__]
    )
    @dataset_admission(rate_limit=True, billing_resources=("vector_space",), require_paid_segments=True)
    @model_validate(ChildChunkUpdatePayload)
    def patch(
        self,
        payload: ChildChunkUpdatePayload,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
        child_chunk_id: UUID,
    ):
        try:
            result = application_services().knowledge.segments.update_child_chunk(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                segment_id=str(segment_id),
                child_chunk_id=str(child_chunk_id),
                content=payload.content,
            )
        except Exception as error:
            _raise_child_chunk_write_error(error)
        return dump_response(ChildChunkDetailResponse, {"data": result}), 200
