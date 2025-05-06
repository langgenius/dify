from flask import request
from flask_login import current_user
from flask_restful import marshal, reqparse
from werkzeug.exceptions import NotFound

from controllers.service_api import api
from controllers.service_api.app.error import ProviderNotInitializeError
from controllers.service_api.wraps import (
    DatasetApiResource,
    cloud_edition_billing_knowledge_limit_check,
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
from services.errors.chunk import (
    ChildChunkDeleteIndexError,
    ChildChunkIndexingError,
)
from services.errors.chunk import (
    ChildChunkDeleteIndexError as ChildChunkDeleteIndexServiceError,
)
from services.errors.chunk import (
    ChildChunkIndexingError as ChildChunkIndexingServiceError,
)


class SegmentApi(DatasetApiResource):
    """Resource for segments."""

    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    def post(self, tenant_id, dataset_id, document_id):
        """Create single segment."""
        # check dataset
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document_id = str(document_id)
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
        parser = reqparse.RequestParser()
        parser.add_argument("segments", type=list, required=False, nullable=True, location="json")
        args = parser.parse_args()
        if args["segments"] is not None:
            for args_item in args["segments"]:
                SegmentService.segment_create_args_validate(args_item, document)
            segments = SegmentService.multi_create_segment(args["segments"], document, dataset)
            return {"data": marshal(segments, segment_fields), "doc_form": document.doc_form}, 200
        else:
            return {"error": "Segments is required"}, 400

    def get(self, tenant_id, dataset_id, document_id):
        """Get segments."""
        # check dataset
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document_id = str(document_id)
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

        parser = reqparse.RequestParser()
        parser.add_argument("status", type=str, action="append", default=[], location="args")
        parser.add_argument("keyword", type=str, default=None, location="args")
        args = parser.parse_args()

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


class DatasetSegmentApi(DatasetApiResource):
    def delete(self, tenant_id, dataset_id, document_id, segment_id):
        # check dataset
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        # check segment
        segment_id = str(segment_id)
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")
        SegmentService.delete_segment(segment, document, dataset)
        return {"result": "success"}, 204

    @cloud_edition_billing_resource_check("vector_space", "dataset")
    def post(self, tenant_id, dataset_id, document_id, segment_id):
        # check dataset
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id = str(document_id)
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
        segment_id = str(segment_id)
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")

        # validate args
        parser = reqparse.RequestParser()
        parser.add_argument("segment", type=dict, required=False, nullable=True, location="json")
        args = parser.parse_args()

        updated_segment = SegmentService.update_segment(
            SegmentUpdateArgs(**args["segment"]), segment, document, dataset
        )
        return {"data": marshal(updated_segment, segment_fields), "doc_form": document.doc_form}, 200


class ChildChunkApi(DatasetApiResource):
    """Resource for child chunks."""

    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    def post(self, tenant_id, dataset_id, document_id, segment_id):
        """Create child chunk."""
        # check dataset
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")

        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")

        # check segment
        segment_id = str(segment_id)
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
        parser = reqparse.RequestParser()
        parser.add_argument("content", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()

        try:
            child_chunk = SegmentService.create_child_chunk(args.get("content"), segment, document, dataset)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))

        return {"data": marshal(child_chunk, child_chunk_fields)}, 200

    def get(self, tenant_id, dataset_id, document_id, segment_id):
        """Get child chunks."""
        # check dataset
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")

        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")

        # check segment
        segment_id = str(segment_id)
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")

        parser = reqparse.RequestParser()
        parser.add_argument("limit", type=int, default=20, location="args")
        parser.add_argument("keyword", type=str, default=None, location="args")
        parser.add_argument("page", type=int, default=1, location="args")
        args = parser.parse_args()

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


class DatasetChildChunkApi(DatasetApiResource):
    """Resource for updating child chunks."""

    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    def delete(self, tenant_id, dataset_id, document_id, segment_id, child_chunk_id):
        """Delete child chunk."""
        # check dataset
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")

        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")

        # check segment
        segment_id = str(segment_id)
        segment = SegmentService.get_segment_by_id(segment_id=segment_id, tenant_id=current_user.current_tenant_id)
        if not segment:
            raise NotFound("Segment not found.")

        # check child chunk
        child_chunk_id = str(child_chunk_id)
        child_chunk = SegmentService.get_child_chunk_by_id(
            child_chunk_id=child_chunk_id, tenant_id=current_user.current_tenant_id
        )
        if not child_chunk:
            raise NotFound("Child chunk not found.")

        try:
            SegmentService.delete_child_chunk(child_chunk, dataset)
        except ChildChunkDeleteIndexServiceError as e:
            raise ChildChunkDeleteIndexError(str(e))

        return {"result": "success"}, 204

    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_knowledge_limit_check("add_segment", "dataset")
    def patch(self, tenant_id, dataset_id, document_id, segment_id, child_chunk_id):
        """Update child chunk."""
        # check dataset
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
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

        # get child chunk
        child_chunk = SegmentService.get_child_chunk_by_id(
            child_chunk_id=child_chunk_id, tenant_id=current_user.current_tenant_id
        )
        if not child_chunk:
            raise NotFound("Child chunk not found.")

        # validate args
        parser = reqparse.RequestParser()
        parser.add_argument("content", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()

        try:
            child_chunk = SegmentService.update_child_chunk(
                args.get("content"), child_chunk, segment, document, dataset
            )
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))

        return {"data": marshal(child_chunk, child_chunk_fields)}, 200


api.add_resource(SegmentApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments")
api.add_resource(
    DatasetSegmentApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>"
)
api.add_resource(
    ChildChunkApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks"
)
api.add_resource(
    DatasetChildChunkApi,
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks/<uuid:child_chunk_id>",
)
