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
from fields.segment_fields import segment_fields
from models.dataset import Dataset, DocumentSegment
from services.dataset_service import DatasetService, DocumentService, SegmentService


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
                    "No Embedding Model available. Please configure a valid provider "
                    "in the Settings -> Model Provider."
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
            return {"error": "Segemtns is required"}, 400

    def get(self, tenant_id, dataset_id, document_id):
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
                    "No Embedding Model available. Please configure a valid provider "
                    "in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)

        parser = reqparse.RequestParser()
        parser.add_argument("status", type=str, action="append", default=[], location="args")
        parser.add_argument("keyword", type=str, default=None, location="args")
        args = parser.parse_args()

        status_list = args["status"]
        keyword = args["keyword"]

        query = DocumentSegment.query.filter(
            DocumentSegment.document_id == str(document_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        )

        if status_list:
            query = query.filter(DocumentSegment.status.in_(status_list))

        if keyword:
            query = query.where(DocumentSegment.content.ilike(f"%{keyword}%"))

        total = query.count()
        segments = query.order_by(DocumentSegment.position).all()
        return {"data": marshal(segments, segment_fields), "doc_form": document.doc_form, "total": total}, 200


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
        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()
        if not segment:
            raise NotFound("Segment not found.")
        SegmentService.delete_segment(segment, document, dataset)
        return {"result": "success"}, 200

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
                    "No Embedding Model available. Please configure a valid provider "
                    "in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
            # check segment
        segment_id = str(segment_id)
        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()
        if not segment:
            raise NotFound("Segment not found.")

        # validate args
        parser = reqparse.RequestParser()
        parser.add_argument("segment", type=dict, required=False, nullable=True, location="json")
        args = parser.parse_args()

        SegmentService.segment_create_args_validate(args["segment"], document)
        segment = SegmentService.update_segment(args["segment"], segment, document, dataset)
        return {"data": marshal(segment, segment_fields), "doc_form": document.doc_form}, 200


api.add_resource(SegmentApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments")
api.add_resource(
    DatasetSegmentApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>"
)
