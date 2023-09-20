import datetime
import uuid

from flask import current_app, request
from flask_login import current_user
from flask_restful import reqparse, marshal, fields
from werkzeug.exceptions import NotFound

import services.dataset_service
from controllers.service_api import api
from controllers.service_api.app.error import ProviderNotInitializeError
from controllers.service_api.dataset.error import ArchivedDocumentImmutableError, DocumentIndexingError, \
    DatasetNotInitedError
from controllers.service_api.wraps import DatasetApiResource
from core.model_providers.error import ProviderTokenNotInitError, LLMBadRequestError
from core.model_providers.model_factory import ModelFactory
from extensions.ext_database import db
from extensions.ext_storage import storage
from fields.segment_fields import segment_fields
from libs.helper import TimestampField
from models.dataset import Dataset
from models.model import UploadFile
from services.dataset_service import DocumentService, SegmentService
from services.file_service import FileService


class SegmentApi(DatasetApiResource):
    """Resource for segments."""

    def post(self, document_id, dataset):
        """Create single segment."""
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
        segment = SegmentService.create_segment(args, document, dataset)
        return {
            'data': marshal(segment, segment_fields),
            'doc_form': document.doc_form
        }, 200


api.add_resource(SegmentApi, '/text/documents')
api.add_resource(DocumentAddByFileApi, '/file/documents')
api.add_resource(DocumentApi, '/documents/<uuid:document_id>')
