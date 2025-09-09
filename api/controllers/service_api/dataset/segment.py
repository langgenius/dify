from flask import request
from flask_login import current_user
from flask_restx import marshal, reqparse
from werkzeug.exceptions import NotFound

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
from core.model_runtime.entities.model_entities import ModelType
from extensions.ext_database import db
from fields.segment_fields import child_chunk_fields, segment_fields
from models.dataset import Dataset
from services.dataset_service import DatasetService, DocumentService, SegmentService
from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs
from services.errors.chunk import ChildChunkDeleteIndexError, ChildChunkIndexingError
from services.errors.chunk import ChildChunkDeleteIndexError as ChildChunkDeleteIndexServiceError
from services.errors.chunk import ChildChunkIndexingError as ChildChunkIndexingServiceError

# Define parsers for segment operations
segment_create_parser = reqparse.RequestParser()
segment_create_parser.add_argument("segments", type=list, required=False, nullable=True, location="json")

segment_list_parser = reqparse.RequestParser()
segment_list_parser.add_argument("status", type=str, action="append", default=[], location="args")
segment_list_parser.add_argument("keyword", type=str, default=None, location="args")

segment_update_parser = reqparse.RequestParser()
segment_update_parser.add_argument("segment", type=dict, required=False, nullable=True, location="json")

child_chunk_create_parser = reqparse.RequestParser()
child_chunk_create_parser.add_argument("content", type=str, required=True, nullable=False, location="json")

child_chunk_list_parser = reqparse.RequestParser()
child_chunk_list_parser.add_argument("limit", type=int, default=20, location="args")
child_chunk_list_parser.add_argument("keyword", type=str, default=None, location="args")
child_chunk_list_parser.add_argument("page", type=int, default=1, location="args")

child_chunk_update_parser = reqparse.RequestParser()
child_chunk_update_parser.add_argument("content", type=str, required=True, nullable=False, location="json")


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments")
class SegmentApi(DatasetApiResource):
    """Resource for segments."""

    @service_api_ns.expect(segment_create_parser)
    @service_api_ns.doc("create_segments")
    @service_api_ns.doc(description="Create segments in a document")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @service_api_ns.doc(
        responses={
            200: "Segments created successfully",
            400: "Bad request - segments data is missing",
            401: "Unauthorized - invalid API token",
            404: "Dataset or document not found",
        }
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id: str, dataset_id: str, document_id: str):
        """Create single segment."""
        # check dataset
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")
        if document.indexing_status != "completed":
            raise NotFound("Document is not completed.")
        if not document.enabled:
            raise NotFound("Document is disabled.")
        # check embedding model setting
        if dataset.indexing_technique == "high_quality":
            try:
                model_manager = ModelManager()
                model_manager.get_model_instance(
                    tenant_id=current_user.current_tenant_id,
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
        args = segment_create_parser.parse_args()
        if args["segments"] is not None:
            for args_item in args["segments"]:
                SegmentService.segment_create_args_validate(args_item, document)
            segments = SegmentService.multi_create_segment(args["segments"], document, dataset)
            return {"data": marshal(segments, segment_fields), "doc_form": document.doc_form}, 200
        else:
            return {"error": "Segments is required"}, 400

    @service_api_ns.expect(segment_list_parser)
    @service_api_ns.doc("list_segments")
    @service_api_ns.doc(description="List segments in a document")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @service_api_ns.doc(
        responses={
            200: "Segments retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset or document not found",
        }
    )
    def get(self, tenant_id: str, dataset_id: str, document_id: str):
        """Get segments."""
        # check dataset
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")
        # check embedding model setting
        if dataset.indexing_technique == "high_quality":
            try:
                model_manager = ModelManager()
                model_manager.get_model_instance(
                    tenant_id=current_user.current_tenant_id,
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

        args = segment_list_parser.parse_args()

        segments, total = SegmentService.get_segments(
            document_id=document_id,
            tenant_id=current_user.current_tenant_id,
            status_list=args["status"],
            keyword=args["keyword"],
            page=page,
            limit=limit,
        )

        response = {
            "data": marshal(segments, segment_fields),
            "doc_form": document.doc_form,
            "total": total,
            "has_more": len(segments) == limit,
            "limit": limit,
            "page": page,
        }

        return response, 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>")
class DatasetSegmentApi(DatasetApiResource):
    @service_api_ns.doc("delete_segment")
    @service_api_ns.doc(description="Delete a specific segment")
    @service_api_ns.doc(
        params={"dataset_id": "Dataset ID", "document_id": "Document ID", "segment_id": "Segment ID to delete"}
    )
    @service_api_ns.doc(
        responses={
            204: "Segment deleted successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def delete(self, tenant_id: str, dataset_id: str, document_id: str, segment_id: str):
        # check dataset
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        # check segment
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")
        SegmentService.delete_segment(segment, document, dataset)
        return 204

    @service_api_ns.expect(segment_update_parser)
    @service_api_ns.doc("update_segment")
    @service_api_ns.doc(description="Update a specific segment")
    @service_api_ns.doc(
        params={"dataset_id": "Dataset ID", "document_id": "Document ID", "segment_id": "Segment ID to update"}
    )
    @service_api_ns.doc(
        responses={
            200: "Segment updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id: str, dataset_id: str, document_id: str, segment_id: str):
        # check dataset
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        if dataset.indexing_technique == "high_quality":
            # check embedding model setting
            try:
                model_manager = ModelManager()
                model_manager.get_model_instance(
                    tenant_id=current_user.current_tenant_id,
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
            # check segment
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")

        # validate args
        args = segment_update_parser.parse_args()

        updated_segment = SegmentService.update_segment(
            SegmentUpdateArgs(**args["segment"]), segment, document, dataset
        )
        return {"data": marshal(updated_segment, segment_fields), "doc_form": document.doc_form}, 200

    @service_api_ns.doc("get_segment")
    @service_api_ns.doc(description="Get a specific segment by ID")
    @service_api_ns.doc(
        responses={
            200: "Segment retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    def get(self, tenant_id: str, dataset_id: str, document_id: str, segment_id: str):
        # check dataset
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        # check segment
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")

        return {"data": marshal(segment, segment_fields), "doc_form": document.doc_form}, 200


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks"
)
class ChildChunkApi(DatasetApiResource):
    """Resource for child chunks."""

    @service_api_ns.expect(child_chunk_create_parser)
    @service_api_ns.doc("create_child_chunk")
    @service_api_ns.doc(description="Create a new child chunk for a segment")
    @service_api_ns.doc(
        params={"dataset_id": "Dataset ID", "document_id": "Document ID", "segment_id": "Parent segment ID"}
    )
    @service_api_ns.doc(
        responses={
            200: "Child chunk created successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id: str, dataset_id: str, document_id: str, segment_id: str):
        """Create child chunk."""
        # check dataset
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")

        # check document
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")

        # check segment
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")

        # check embedding model setting
        if dataset.indexing_technique == "high_quality":
            try:
                model_manager = ModelManager()
                model_manager.get_model_instance(
                    tenant_id=current_user.current_tenant_id,
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
        args = child_chunk_create_parser.parse_args()

        try:
            child_chunk = SegmentService.create_child_chunk(args["content"], segment, document, dataset)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))

        return {"data": marshal(child_chunk, child_chunk_fields)}, 200

    @service_api_ns.expect(child_chunk_list_parser)
    @service_api_ns.doc("list_child_chunks")
    @service_api_ns.doc(description="List child chunks for a segment")
    @service_api_ns.doc(
        params={"dataset_id": "Dataset ID", "document_id": "Document ID", "segment_id": "Parent segment ID"}
    )
    @service_api_ns.doc(
        responses={
            200: "Child chunks retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or segment not found",
        }
    )
    def get(self, tenant_id: str, dataset_id: str, document_id: str, segment_id: str):
        """Get child chunks."""
        # check dataset
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")

        # check document
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")

        # check segment
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")

        args = child_chunk_list_parser.parse_args()

        page = args["page"]
        limit = min(args["limit"], 100)
        keyword = args["keyword"]

        child_chunks = SegmentService.get_child_chunks(segment_id, document_id, dataset_id, page, limit, keyword)

        return {
            "data": marshal(child_chunks.items, child_chunk_fields),
            "total": child_chunks.total,
            "total_pages": child_chunks.pages,
            "page": page,
            "limit": limit,
        }, 200


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks/<uuid:child_chunk_id>"
)
class DatasetChildChunkApi(DatasetApiResource):
    """Resource for updating child chunks."""

    @service_api_ns.doc("delete_child_chunk")
    @service_api_ns.doc(description="Delete a specific child chunk")
    @service_api_ns.doc(
        params={
            "dataset_id": "Dataset ID",
            "document_id": "Document ID",
            "segment_id": "Parent segment ID",
            "child_chunk_id": "Child chunk ID to delete",
        }
    )
    @service_api_ns.doc(
        responses={
            204: "Child chunk deleted successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, segment, or child chunk not found",
        }
    )
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def delete(self, tenant_id: str, dataset_id: str, document_id: str, segment_id: str, child_chunk_id: str):
        """Delete child chunk."""
        # check dataset
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")

        # check document
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")

        # check segment
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")

        # validate segment belongs to the specified document
        if str(segment.document_id) != str(document_id):
            raise NotFound("Document not found.")

        # check child chunk
        child_chunk = SegmentService.get_child_chunk_by_id(
            child_chunk_id=child_chunk_id, tenant_id=current_user.current_tenant_id
        )
        if not child_chunk:
            raise NotFound("Child chunk not found.")

        # validate child chunk belongs to the specified segment
        if str(child_chunk.segment_id) != str(segment.id):
            raise NotFound("Child chunk not found.")

        try:
            SegmentService.delete_child_chunk(child_chunk, dataset)
        except ChildChunkDeleteIndexServiceError as e:
            raise ChildChunkDeleteIndexError(str(e))

        return 204

    @service_api_ns.expect(child_chunk_update_parser)
    @service_api_ns.doc("update_child_chunk")
    @service_api_ns.doc(description="Update a specific child chunk")
    @service_api_ns.doc(
        params={
            "dataset_id": "Dataset ID",
            "document_id": "Document ID",
            "segment_id": "Parent segment ID",
            "child_chunk_id": "Child chunk ID to update",
        }
    )
    @service_api_ns.doc(
        responses={
            200: "Child chunk updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, segment, or child chunk not found",
        }
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def patch(self, tenant_id: str, dataset_id: str, document_id: str, segment_id: str, child_chunk_id: str):
        """Update child chunk."""
        # check dataset
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")

        # get document
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")

        # get segment
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")

        # validate segment belongs to the specified document
        if str(segment.document_id) != str(document_id):
            raise NotFound("Segment not found.")

        # get child chunk
        child_chunk = SegmentService.get_child_chunk_by_id(
            child_chunk_id=child_chunk_id, tenant_id=current_user.current_tenant_id
        )
        if not child_chunk:
            raise NotFound("Child chunk not found.")

        # validate child chunk belongs to the specified segment
        if str(child_chunk.segment_id) != str(segment.id):
            raise NotFound("Child chunk not found.")

        # validate args
        args = child_chunk_update_parser.parse_args()

        try:
            child_chunk = SegmentService.update_child_chunk(args["content"], child_chunk, segment, document, dataset)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))

        return {"data": marshal(child_chunk, child_chunk_fields)}, 200
