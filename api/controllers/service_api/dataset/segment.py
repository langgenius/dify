from flask_login import current_user
from flask_restful import reqparse, marshal
from werkzeug.exceptions import NotFound

from controllers.service_api import api
from controllers.service_api.app.error import ProviderNotInitializeError
from controllers.service_api.wraps import DatasetApiResource
from core.model_providers.error import ProviderTokenNotInitError, LLMBadRequestError
from core.model_providers.model_factory import ModelFactory
from extensions.ext_database import db
from fields.segment_fields import segment_fields
from models.dataset import Dataset
from services.dataset_service import DocumentService, SegmentService


class SegmentApi(DatasetApiResource):
    """Resource for segments."""
    def post(self, tenant_id, dataset_id, document_id):
        """Create single segment."""
        # check dataset
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(
            Dataset.tenant_id == tenant_id,
            Dataset.id == dataset_id
        ).first()
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound('Document not found.')
        # check embedding model setting
        if dataset.indexing_technique == 'high_quality':
            try:
                ModelFactory.get_embedding_model(
                    tenant_id=current_user.current_tenant_id,
                    model_provider_name=dataset.embedding_model_provider,
                    model_name=dataset.embedding_model
                )
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    f"No Embedding Model available. Please configure a valid provider "
                    f"in the Settings -> Model Provider.")
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
        # validate args
        parser = reqparse.RequestParser()
        parser.add_argument('segments', type=list, required=False, nullable=True, location='json')
        args = parser.parse_args()
        for args_item in args['segments']:
            SegmentService.segment_create_args_validate(args_item, document)
        segments = SegmentService.multi_create_segment(args['segments'], document, dataset)
        return {
            'data': marshal(segments, segment_fields),
            'doc_form': document.doc_form
        }, 200


api.add_resource(SegmentApi, '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments')
