import datetime
import uuid

from flask import current_app, request
from flask_restful import reqparse
from werkzeug.exceptions import NotFound

import services.dataset_service
from controllers.service_api import api
from controllers.service_api.app.error import ProviderNotInitializeError
from controllers.service_api.dataset.error import ArchivedDocumentImmutableError, DocumentIndexingError, \
    DatasetNotInitedError
from controllers.service_api.wraps import DatasetApiResource
from core.model_providers.error import ProviderTokenNotInitError
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.dataset import Dataset
from models.model import UploadFile
from services.dataset_service import DocumentService
from services.file_service import FileService


class DocumentAddByTextApi(DatasetApiResource):
    """Resource for documents."""

    def post(self, dataset):
        """Create document by text."""
        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, nullable=False, location='json')
        parser.add_argument('text', type=str, required=True, nullable=False, location='json')
        parser.add_argument('process_rule', type=dict, required=False, nullable=True, location='json')
        parser.add_argument('original_document_id', type=str, required=False, location='json')
        parser.add_argument('doc_form', type=str, default='text_model', required=False, nullable=False, location='json')
        parser.add_argument('doc_language', type=str, default='English', required=False, nullable=False,
                            location='json')
        parser.add_argument('indexing_technique', type=str, choices=Dataset.INDEXING_TECHNIQUE_LIST, nullable=False,
                            location='json')
        parser.add_argument('doc_type', type=str, required=False, nullable=True, location='json')
        parser.add_argument('doc_metadata', type=str, required=False, nullable=True, location='json')
        args = parser.parse_args()

        if not dataset.indexing_technique and not args['indexing_technique']:
            raise ValueError('indexing_technique is required.')

        # validate args
        DocumentService.document_create_args_validate(args)

        doc_type = args.get('doc_type')
        doc_metadata = args.get('doc_metadata')

        if doc_type and doc_type not in DocumentService.DOCUMENT_METADATA_SCHEMA:
            raise ValueError('Invalid doc_type.')

        upload_file = FileService.upload_text(args.get('text'), args.get('text_name'))
        document_data = {
            'data_source': {
                'type': 'upload_file',
                'info_list': {
                    'data_source_type': 'upload_file',
                    'file_info_list': {
                        'file_ids': [upload_file.id]
                    }
                }
            }
        }

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                document_data=document_data,
                account=dataset.created_by_account,
                dataset_process_rule=dataset.latest_process_rule,
                created_from='api'
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]
        if doc_type and doc_metadata:
            metadata_schema = DocumentService.DOCUMENT_METADATA_SCHEMA[doc_type]

            document.doc_metadata = {}

            for key, value_type in metadata_schema.items():
                value = doc_metadata.get(key)
                if value is not None and isinstance(value, value_type):
                    document.doc_metadata[key] = value

            document.doc_type = doc_type
            document.updated_at = datetime.datetime.utcnow()
            db.session.commit()

        return {'id': document.id}


class DocumentAddByFileApi(DatasetApiResource):
    """Resource for documents."""

    def post(self, dataset):
        """Create document by upload file."""
        parser = reqparse.RequestParser()
        parser.add_argument('process_rule', type=dict, required=False, nullable=True, location='json')
        parser.add_argument('original_document_id', type=str, required=False, location='json')
        parser.add_argument('doc_form', type=str, default='text_model', required=False, nullable=False, location='json')
        parser.add_argument('doc_language', type=str, default='English', required=False, nullable=False,
                            location='json')
        parser.add_argument('indexing_technique', type=str, choices=Dataset.INDEXING_TECHNIQUE_LIST, nullable=False,
                            location='json')
        parser.add_argument('doc_type', type=str, required=False, nullable=True, location='json')
        parser.add_argument('doc_metadata', type=str, required=False, nullable=True, location='json')
        args = parser.parse_args()

        if not dataset.indexing_technique and not args['indexing_technique']:
            raise ValueError('indexing_technique is required.')

        # validate args
        DocumentService.document_create_args_validate(args)

        doc_type = args.get('doc_type')
        doc_metadata = args.get('doc_metadata')

        if doc_type and doc_type not in DocumentService.DOCUMENT_METADATA_SCHEMA:
            raise ValueError('Invalid doc_type.')
        # save file info
        file = request.files['file']
        upload_file = FileService.upload_file(file)
        data_source = {
            'type': 'upload_file',
            'info_list': {
                'file_info_list': {
                    'file_ids': [upload_file.id]
                }
            }
        }
        args['data_source'] = data_source

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                document_data=args,
                account=dataset.created_by_account,
                dataset_process_rule=dataset.latest_process_rule,
                created_from='api'
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]
        if doc_type and doc_metadata:
            metadata_schema = DocumentService.DOCUMENT_METADATA_SCHEMA[doc_type]

            document.doc_metadata = {}

            for key, value_type in metadata_schema.items():
                value = doc_metadata.get(key)
                if value is not None and isinstance(value, value_type):
                    document.doc_metadata[key] = value

            document.doc_type = doc_type
            document.updated_at = datetime.datetime.utcnow()
            db.session.commit()

        return {'id': document.id}


class DocumentApi(DatasetApiResource):
    def delete(self, dataset, document_id):
        """Delete document."""
        document_id = str(document_id)

        document = DocumentService.get_document(dataset.id, document_id)

        # 404 if document not found
        if document is None:
            raise NotFound("Document Not Exists.")

        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()

        try:
            # delete document
            DocumentService.delete_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError('Cannot delete document during indexing.')

        return {'result': 'success'}, 204


api.add_resource(DocumentAddByTextApi, '/text/documents')
api.add_resource(DocumentAddByFileApi, '/file/documents')
api.add_resource(DocumentApi, '/documents/<uuid:document_id>')
