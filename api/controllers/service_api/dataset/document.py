import datetime
import uuid

from flask import current_app
from flask_restful import reqparse
from werkzeug.exceptions import NotFound

import services.dataset_service
from controllers.service_api import api
from controllers.service_api.app.error import ProviderNotInitializeError
from controllers.service_api.dataset.error import ArchivedDocumentImmutableError, DocumentIndexingError, \
    DatasetNotInitedError
from controllers.service_api.wraps import DatasetApiResource
from core.llm.error import ProviderTokenNotInitError
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import UploadFile
from services.dataset_service import DocumentService


class DocumentListApi(DatasetApiResource):
    """Resource for documents."""

    def post(self, dataset):
        """Create document."""
        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, nullable=False, location='json')
        parser.add_argument('text', type=str, required=True, nullable=False, location='json')
        parser.add_argument('doc_type', type=str, location='json')
        parser.add_argument('doc_metadata', type=dict, location='json')
        args = parser.parse_args()

        if not dataset.indexing_technique:
            raise DatasetNotInitedError("Dataset indexing technique must be set.")

        doc_type = args.get('doc_type')
        doc_metadata = args.get('doc_metadata')

        if doc_type and doc_type not in DocumentService.DOCUMENT_METADATA_SCHEMA:
            raise ValueError('Invalid doc_type.')

        # user uuid as file name
        file_uuid = str(uuid.uuid4())
        file_key = 'upload_files/' + dataset.tenant_id + '/' + file_uuid + '.txt'

        # save file to storage
        storage.save(file_key, args.get('text'))

        # save file to db
        config = current_app.config
        upload_file = UploadFile(
            tenant_id=dataset.tenant_id,
            storage_type=config['STORAGE_TYPE'],
            key=file_key,
            name=args.get('name') + '.txt',
            size=len(args.get('text')),
            extension='txt',
            mime_type='text/plain',
            created_by=dataset.created_by,
            created_at=datetime.datetime.utcnow(),
            used=True,
            used_by=dataset.created_by,
            used_at=datetime.datetime.utcnow()
        )

        db.session.add(upload_file)
        db.session.commit()

        document_data = {
            'data_source': {
                'type': 'upload_file',
                'info': [
                    {
                        'upload_file_id': upload_file.id
                    }
                ]
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


api.add_resource(DocumentListApi, '/documents')
api.add_resource(DocumentApi, '/documents/<uuid:document_id>')
