import logging
from argparse import ArgumentTypeError
from datetime import datetime, timezone

from flask import request
from flask_login import current_user
from flask_restful import Resource, fields, marshal, marshal_with, reqparse
from sqlalchemy import asc, desc
from transformers.hf_argparser import string_to_bool
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import api
from controllers.console.app.error import (
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets.error import (
    ArchivedDocumentImmutableError,
    DocumentAlreadyFinishedError,
    DocumentIndexingError,
    IndexingEstimateError,
    InvalidActionError,
    InvalidMetadataError,
)
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.indexing_runner import IndexingRunner
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeAuthorizationError
from core.rag.extractor.entity.extract_setting import ExtractSetting
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from fields.document_fields import (
    dataset_and_document_fields,
    document_fields,
    document_status_fields,
    document_with_segments_fields,
)
from libs.login import login_required
from models.dataset import Dataset, DatasetProcessRule, Document, DocumentSegment
from models.model import UploadFile
from services.dataset_service import DatasetService, DocumentService
from tasks.add_document_to_index_task import add_document_to_index_task
from tasks.remove_document_from_index_task import remove_document_from_index_task


class DocumentResource(Resource):
    def get_document(self, dataset_id: str, document_id: str) -> Document:
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound('Dataset not found.')

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        document = DocumentService.get_document(dataset_id, document_id)

        if not document:
            raise NotFound('Document not found.')

        if document.tenant_id != current_user.current_tenant_id:
            raise Forbidden('No permission.')

        return document

    def get_batch_documents(self, dataset_id: str, batch: str) -> list[Document]:
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound('Dataset not found.')

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        documents = DocumentService.get_batch_documents(dataset_id, batch)

        if not documents:
            raise NotFound('Documents not found.')

        return documents


class GetProcessRuleApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        req_data = request.args

        document_id = req_data.get('document_id')

        # get default rules
        mode = DocumentService.DEFAULT_RULES['mode']
        rules = DocumentService.DEFAULT_RULES['rules']
        if document_id:
            # get the latest process rule
            document = Document.query.get_or_404(document_id)

            dataset = DatasetService.get_dataset(document.dataset_id)

            if not dataset:
                raise NotFound('Dataset not found.')

            try:
                DatasetService.check_dataset_permission(dataset, current_user)
            except services.errors.account.NoPermissionError as e:
                raise Forbidden(str(e))

            # get the latest process rule
            dataset_process_rule = db.session.query(DatasetProcessRule). \
                filter(DatasetProcessRule.dataset_id == document.dataset_id). \
                order_by(DatasetProcessRule.created_at.desc()). \
                limit(1). \
                one_or_none()
            if dataset_process_rule:
                mode = dataset_process_rule.mode
                rules = dataset_process_rule.rules_dict

        return {
            'mode': mode,
            'rules': rules
        }


class DatasetDocumentListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id = str(dataset_id)
        page = request.args.get('page', default=1, type=int)
        limit = request.args.get('limit', default=20, type=int)
        search = request.args.get('keyword', default=None, type=str)
        sort = request.args.get('sort', default='-created_at', type=str)
        # "yes", "true", "t", "y", "1" convert to True, while others convert to False.
        try:
            fetch = string_to_bool(request.args.get('fetch', default='false'))
        except (ArgumentTypeError, ValueError, Exception) as e:
            fetch = False
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound('Dataset not found.')

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        query = Document.query.filter_by(
            dataset_id=str(dataset_id), tenant_id=current_user.current_tenant_id)

        if search:
            search = f'%{search}%'
            query = query.filter(Document.name.like(search))

        if sort.startswith('-'):
            sort_logic = desc
            sort = sort[1:]
        else:
            sort_logic = asc

        if sort == 'hit_count':
            sub_query = db.select(DocumentSegment.document_id,
                                  db.func.sum(DocumentSegment.hit_count).label("total_hit_count")) \
                .group_by(DocumentSegment.document_id) \
                .subquery()

            query = query.outerjoin(sub_query, sub_query.c.document_id == Document.id) \
                .order_by(sort_logic(db.func.coalesce(sub_query.c.total_hit_count, 0)))
        elif sort == 'created_at':
            query = query.order_by(sort_logic(Document.created_at))
        else:
            query = query.order_by(desc(Document.created_at))

        paginated_documents = query.paginate(
            page=page, per_page=limit, max_per_page=100, error_out=False)
        documents = paginated_documents.items
        if fetch:
            for document in documents:
                completed_segments = DocumentSegment.query.filter(DocumentSegment.completed_at.isnot(None),
                                                                  DocumentSegment.document_id == str(document.id),
                                                                  DocumentSegment.status != 're_segment').count()
                total_segments = DocumentSegment.query.filter(DocumentSegment.document_id == str(document.id),
                                                              DocumentSegment.status != 're_segment').count()
                document.completed_segments = completed_segments
                document.total_segments = total_segments
            data = marshal(documents, document_with_segments_fields)
        else:
            data = marshal(documents, document_fields)
        response = {
            'data': data,
            'has_more': len(documents) == limit,
            'limit': limit,
            'total': paginated_documents.total,
            'page': page
        }

        return response

    documents_and_batch_fields = {
        'documents': fields.List(fields.Nested(document_fields)),
        'batch': fields.String
    }

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(documents_and_batch_fields)
    @cloud_edition_billing_resource_check('vector_space')
    def post(self, dataset_id):
        dataset_id = str(dataset_id)

        dataset = DatasetService.get_dataset(dataset_id)

        if not dataset:
            raise NotFound('Dataset not found.')

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        parser = reqparse.RequestParser()
        parser.add_argument('indexing_technique', type=str, choices=Dataset.INDEXING_TECHNIQUE_LIST, nullable=False,
                            location='json')
        parser.add_argument('data_source', type=dict, required=False, location='json')
        parser.add_argument('process_rule', type=dict, required=False, location='json')
        parser.add_argument('duplicate', type=bool, default=True, nullable=False, location='json')
        parser.add_argument('original_document_id', type=str, required=False, location='json')
        parser.add_argument('doc_form', type=str, default='text_model', required=False, nullable=False, location='json')
        parser.add_argument('doc_language', type=str, default='English', required=False, nullable=False,
                            location='json')
        parser.add_argument('retrieval_model', type=dict, required=False, nullable=False,
                            location='json')
        args = parser.parse_args()

        if not dataset.indexing_technique and not args['indexing_technique']:
            raise ValueError('indexing_technique is required.')

        # validate args
        DocumentService.document_create_args_validate(args)

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(dataset, args, current_user)
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()

        return {
            'documents': documents,
            'batch': batch
        }


class DatasetInitApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(dataset_and_document_fields)
    @cloud_edition_billing_resource_check('vector_space')
    def post(self):
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('indexing_technique', type=str, choices=Dataset.INDEXING_TECHNIQUE_LIST, required=True,
                            nullable=False, location='json')
        parser.add_argument('data_source', type=dict, required=True, nullable=True, location='json')
        parser.add_argument('process_rule', type=dict, required=True, nullable=True, location='json')
        parser.add_argument('doc_form', type=str, default='text_model', required=False, nullable=False, location='json')
        parser.add_argument('doc_language', type=str, default='English', required=False, nullable=False,
                            location='json')
        parser.add_argument('retrieval_model', type=dict, required=False, nullable=False,
                            location='json')
        args = parser.parse_args()

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        if args['indexing_technique'] == 'high_quality':
            try:
                model_manager = ModelManager()
                model_manager.get_default_model_instance(
                    tenant_id=current_user.current_tenant_id,
                    model_type=ModelType.TEXT_EMBEDDING
                )
            except InvokeAuthorizationError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider "
                    "in the Settings -> Model Provider.")
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)

        # validate args
        DocumentService.document_create_args_validate(args)

        try:
            dataset, documents, batch = DocumentService.save_document_without_dataset_id(
                tenant_id=current_user.current_tenant_id,
                document_data=args,
                account=current_user
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()

        response = {
            'dataset': dataset,
            'documents': documents,
            'batch': batch
        }

        return response


class DocumentIndexingEstimateApi(DocumentResource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        document = self.get_document(dataset_id, document_id)

        if document.indexing_status in ['completed', 'error']:
            raise DocumentAlreadyFinishedError()

        data_process_rule = document.dataset_process_rule
        data_process_rule_dict = data_process_rule.to_dict()

        response = {
            "tokens": 0,
            "total_price": 0,
            "currency": "USD",
            "total_segments": 0,
            "preview": []
        }

        if document.data_source_type == 'upload_file':
            data_source_info = document.data_source_info_dict
            if data_source_info and 'upload_file_id' in data_source_info:
                file_id = data_source_info['upload_file_id']

                file = db.session.query(UploadFile).filter(
                    UploadFile.tenant_id == document.tenant_id,
                    UploadFile.id == file_id
                ).first()

                # raise error if file not found
                if not file:
                    raise NotFound('File not found.')

                extract_setting = ExtractSetting(
                    datasource_type="upload_file",
                    upload_file=file,
                    document_model=document.doc_form
                )

                indexing_runner = IndexingRunner()

                try:
                    response = indexing_runner.indexing_estimate(current_user.current_tenant_id, [extract_setting],
                                                                 data_process_rule_dict, document.doc_form,
                                                                 'English', dataset_id)
                except LLMBadRequestError:
                    raise ProviderNotInitializeError(
                        "No Embedding Model available. Please configure a valid provider "
                        "in the Settings -> Model Provider.")
                except ProviderTokenNotInitError as ex:
                    raise ProviderNotInitializeError(ex.description)
                except Exception as e:
                    raise IndexingEstimateError(str(e))

        return response


class DocumentBatchIndexingEstimateApi(DocumentResource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, batch):
        dataset_id = str(dataset_id)
        batch = str(batch)
        documents = self.get_batch_documents(dataset_id, batch)
        response = {
            "tokens": 0,
            "total_price": 0,
            "currency": "USD",
            "total_segments": 0,
            "preview": []
        }
        if not documents:
            return response
        data_process_rule = documents[0].dataset_process_rule
        data_process_rule_dict = data_process_rule.to_dict()
        info_list = []
        extract_settings = []
        for document in documents:
            if document.indexing_status in ['completed', 'error']:
                raise DocumentAlreadyFinishedError()
            data_source_info = document.data_source_info_dict
            # format document files info
            if data_source_info and 'upload_file_id' in data_source_info:
                file_id = data_source_info['upload_file_id']
                info_list.append(file_id)
            # format document notion info
            elif data_source_info and 'notion_workspace_id' in data_source_info and 'notion_page_id' in data_source_info:
                pages = []
                page = {
                    'page_id': data_source_info['notion_page_id'],
                    'type': data_source_info['type']
                }
                pages.append(page)
                notion_info = {
                    'workspace_id': data_source_info['notion_workspace_id'],
                    'pages': pages
                }
                info_list.append(notion_info)

            if document.data_source_type == 'upload_file':
                file_id = data_source_info['upload_file_id']
                file_detail = db.session.query(UploadFile).filter(
                    UploadFile.tenant_id == current_user.current_tenant_id,
                    UploadFile.id == file_id
                ).first()

                if file_detail is None:
                    raise NotFound("File not found.")

                extract_setting = ExtractSetting(
                    datasource_type="upload_file",
                    upload_file=file_detail,
                    document_model=document.doc_form
                )
                extract_settings.append(extract_setting)

            elif document.data_source_type == 'notion_import':
                extract_setting = ExtractSetting(
                    datasource_type="notion_import",
                    notion_info={
                        "notion_workspace_id": data_source_info['notion_workspace_id'],
                        "notion_obj_id": data_source_info['notion_page_id'],
                        "notion_page_type": data_source_info['type'],
                        "tenant_id": current_user.current_tenant_id
                    },
                    document_model=document.doc_form
                )
                extract_settings.append(extract_setting)
            elif document.data_source_type == 'website_crawl':
                extract_setting = ExtractSetting(
                    datasource_type="website_crawl",
                    website_info={
                        "provider": data_source_info['provider'],
                        "job_id": data_source_info['job_id'],
                        "url": data_source_info['url'],
                        "tenant_id": current_user.current_tenant_id,
                        "mode": data_source_info['mode'],
                        "only_main_content": data_source_info['only_main_content']
                    },
                    document_model=document.doc_form
                )
                extract_settings.append(extract_setting)

            else:
                raise ValueError('Data source type not support')
            indexing_runner = IndexingRunner()
            try:
                response = indexing_runner.indexing_estimate(current_user.current_tenant_id, extract_settings,
                                                             data_process_rule_dict, document.doc_form,
                                                             'English', dataset_id)
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider "
                    "in the Settings -> Model Provider.")
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
            except Exception as e:
                raise IndexingEstimateError(str(e))
        return response


class DocumentBatchIndexingStatusApi(DocumentResource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, batch):
        dataset_id = str(dataset_id)
        batch = str(batch)
        documents = self.get_batch_documents(dataset_id, batch)
        documents_status = []
        for document in documents:
            completed_segments = DocumentSegment.query.filter(DocumentSegment.completed_at.isnot(None),
                                                              DocumentSegment.document_id == str(document.id),
                                                              DocumentSegment.status != 're_segment').count()
            total_segments = DocumentSegment.query.filter(DocumentSegment.document_id == str(document.id),
                                                          DocumentSegment.status != 're_segment').count()
            document.completed_segments = completed_segments
            document.total_segments = total_segments
            if document.is_paused:
                document.indexing_status = 'paused'
            documents_status.append(marshal(document, document_status_fields))
        data = {
            'data': documents_status
        }
        return data


class DocumentIndexingStatusApi(DocumentResource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        document = self.get_document(dataset_id, document_id)

        completed_segments = DocumentSegment.query \
            .filter(DocumentSegment.completed_at.isnot(None),
                    DocumentSegment.document_id == str(document_id),
                    DocumentSegment.status != 're_segment') \
            .count()
        total_segments = DocumentSegment.query \
            .filter(DocumentSegment.document_id == str(document_id),
                    DocumentSegment.status != 're_segment') \
            .count()

        document.completed_segments = completed_segments
        document.total_segments = total_segments
        if document.is_paused:
            document.indexing_status = 'paused'
        return marshal(document, document_status_fields)


class DocumentDetailApi(DocumentResource):
    METADATA_CHOICES = {'all', 'only', 'without'}

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        document = self.get_document(dataset_id, document_id)

        metadata = request.args.get('metadata', 'all')
        if metadata not in self.METADATA_CHOICES:
            raise InvalidMetadataError(f'Invalid metadata value: {metadata}')

        if metadata == 'only':
            response = {
                'id': document.id,
                'doc_type': document.doc_type,
                'doc_metadata': document.doc_metadata
            }
        elif metadata == 'without':
            process_rules = DatasetService.get_process_rules(dataset_id)
            data_source_info = document.data_source_detail_dict
            response = {
                'id': document.id,
                'position': document.position,
                'data_source_type': document.data_source_type,
                'data_source_info': data_source_info,
                'dataset_process_rule_id': document.dataset_process_rule_id,
                'dataset_process_rule': process_rules,
                'name': document.name,
                'created_from': document.created_from,
                'created_by': document.created_by,
                'created_at': document.created_at.timestamp(),
                'tokens': document.tokens,
                'indexing_status': document.indexing_status,
                'completed_at': int(document.completed_at.timestamp()) if document.completed_at else None,
                'updated_at': int(document.updated_at.timestamp()) if document.updated_at else None,
                'indexing_latency': document.indexing_latency,
                'error': document.error,
                'enabled': document.enabled,
                'disabled_at': int(document.disabled_at.timestamp()) if document.disabled_at else None,
                'disabled_by': document.disabled_by,
                'archived': document.archived,
                'segment_count': document.segment_count,
                'average_segment_length': document.average_segment_length,
                'hit_count': document.hit_count,
                'display_status': document.display_status,
                'doc_form': document.doc_form
            }
        else:
            process_rules = DatasetService.get_process_rules(dataset_id)
            data_source_info = document.data_source_detail_dict
            response = {
                'id': document.id,
                'position': document.position,
                'data_source_type': document.data_source_type,
                'data_source_info': data_source_info,
                'dataset_process_rule_id': document.dataset_process_rule_id,
                'dataset_process_rule': process_rules,
                'name': document.name,
                'created_from': document.created_from,
                'created_by': document.created_by,
                'created_at': document.created_at.timestamp(),
                'tokens': document.tokens,
                'indexing_status': document.indexing_status,
                'completed_at': int(document.completed_at.timestamp()) if document.completed_at else None,
                'updated_at': int(document.updated_at.timestamp()) if document.updated_at else None,
                'indexing_latency': document.indexing_latency,
                'error': document.error,
                'enabled': document.enabled,
                'disabled_at': int(document.disabled_at.timestamp()) if document.disabled_at else None,
                'disabled_by': document.disabled_by,
                'archived': document.archived,
                'doc_type': document.doc_type,
                'doc_metadata': document.doc_metadata,
                'segment_count': document.segment_count,
                'average_segment_length': document.average_segment_length,
                'hit_count': document.hit_count,
                'display_status': document.display_status,
                'doc_form': document.doc_form
            }

        return response, 200


class DocumentProcessingApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, dataset_id, document_id, action):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        document = self.get_document(dataset_id, document_id)

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if action == "pause":
            if document.indexing_status != "indexing":
                raise InvalidActionError('Document not in indexing state.')

            document.paused_by = current_user.id
            document.paused_at = datetime.now(timezone.utc).replace(tzinfo=None)
            document.is_paused = True
            db.session.commit()

        elif action == "resume":
            if document.indexing_status not in ["paused", "error"]:
                raise InvalidActionError('Document not in paused or error state.')

            document.paused_by = None
            document.paused_at = None
            document.is_paused = False
            db.session.commit()
        else:
            raise InvalidActionError()

        return {'result': 'success'}, 200


class DocumentDeleteApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if dataset is None:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)

        document = self.get_document(dataset_id, document_id)

        try:
            DocumentService.delete_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError('Cannot delete document during indexing.')

        return {'result': 'success'}, 204


class DocumentMetadataApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    def put(self, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        document = self.get_document(dataset_id, document_id)

        req_data = request.get_json()

        doc_type = req_data.get('doc_type')
        doc_metadata = req_data.get('doc_metadata')

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        if doc_type is None or doc_metadata is None:
            raise ValueError('Both doc_type and doc_metadata must be provided.')

        if doc_type not in DocumentService.DOCUMENT_METADATA_SCHEMA:
            raise ValueError('Invalid doc_type.')

        if not isinstance(doc_metadata, dict):
            raise ValueError('doc_metadata must be a dictionary.')

        metadata_schema = DocumentService.DOCUMENT_METADATA_SCHEMA[doc_type]

        document.doc_metadata = {}
        if doc_type == 'others':
            document.doc_metadata = doc_metadata
        else:
            for key, value_type in metadata_schema.items():
                value = doc_metadata.get(key)
                if value is not None and isinstance(value, value_type):
                    document.doc_metadata[key] = value

        document.doc_type = doc_type
        document.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.session.commit()

        return {'result': 'success', 'message': 'Document metadata updated.'}, 200


class DocumentStatusApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check('vector_space')
    def patch(self, dataset_id, document_id, action):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if dataset is None:
            raise NotFound("Dataset not found.")

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)

        # check user's permission
        DatasetService.check_dataset_permission(dataset, current_user)

        document = self.get_document(dataset_id, document_id)

        indexing_cache_key = 'document_{}_indexing'.format(document.id)
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is not None:
            raise InvalidActionError("Document is being indexed, please try again later")

        if action == "enable":
            if document.enabled:
                raise InvalidActionError('Document already enabled.')

            document.enabled = True
            document.disabled_at = None
            document.disabled_by = None
            document.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.session.commit()

            # Set cache to prevent indexing the same document multiple times
            redis_client.setex(indexing_cache_key, 600, 1)

            add_document_to_index_task.delay(document_id)

            return {'result': 'success'}, 200

        elif action == "disable":
            if not document.completed_at or document.indexing_status != 'completed':
                raise InvalidActionError('Document is not completed.')
            if not document.enabled:
                raise InvalidActionError('Document already disabled.')

            document.enabled = False
            document.disabled_at = datetime.now(timezone.utc).replace(tzinfo=None)
            document.disabled_by = current_user.id
            document.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.session.commit()

            # Set cache to prevent indexing the same document multiple times
            redis_client.setex(indexing_cache_key, 600, 1)

            remove_document_from_index_task.delay(document_id)

            return {'result': 'success'}, 200

        elif action == "archive":
            if document.archived:
                raise InvalidActionError('Document already archived.')

            document.archived = True
            document.archived_at = datetime.now(timezone.utc).replace(tzinfo=None)
            document.archived_by = current_user.id
            document.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.session.commit()

            if document.enabled:
                # Set cache to prevent indexing the same document multiple times
                redis_client.setex(indexing_cache_key, 600, 1)

                remove_document_from_index_task.delay(document_id)

            return {'result': 'success'}, 200
        elif action == "un_archive":
            if not document.archived:
                raise InvalidActionError('Document is not archived.')

            document.archived = False
            document.archived_at = None
            document.archived_by = None
            document.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.session.commit()

            # Set cache to prevent indexing the same document multiple times
            redis_client.setex(indexing_cache_key, 600, 1)

            add_document_to_index_task.delay(document_id)

            return {'result': 'success'}, 200
        else:
            raise InvalidActionError()


class DocumentPauseApi(DocumentResource):

    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, dataset_id, document_id):
        """pause document."""
        dataset_id = str(dataset_id)
        document_id = str(document_id)

        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound('Dataset not found.')

        document = DocumentService.get_document(dataset.id, document_id)

        # 404 if document not found
        if document is None:
            raise NotFound("Document Not Exists.")

        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()

        try:
            # pause document
            DocumentService.pause_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError('Cannot pause completed document.')

        return {'result': 'success'}, 204


class DocumentRecoverApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, dataset_id, document_id):
        """recover document."""
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound('Dataset not found.')
        document = DocumentService.get_document(dataset.id, document_id)

        # 404 if document not found
        if document is None:
            raise NotFound("Document Not Exists.")

        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()
        try:
            # pause document
            DocumentService.recover_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError('Document is not in paused status.')

        return {'result': 'success'}, 204


class DocumentRetryApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, dataset_id):
        """retry document."""

        parser = reqparse.RequestParser()
        parser.add_argument('document_ids', type=list, required=True, nullable=False,
                            location='json')
        args = parser.parse_args()
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        retry_documents = []
        if not dataset:
            raise NotFound('Dataset not found.')
        for document_id in args['document_ids']:
            try:
                document_id = str(document_id)

                document = DocumentService.get_document(dataset.id, document_id)

                # 404 if document not found
                if document is None:
                    raise NotFound("Document Not Exists.")

                # 403 if document is archived
                if DocumentService.check_archived(document):
                    raise ArchivedDocumentImmutableError()

                # 400 if document is completed
                if document.indexing_status == 'completed':
                    raise DocumentAlreadyFinishedError()
                retry_documents.append(document)
            except Exception as e:
                logging.error(f"Document {document_id} retry failed: {str(e)}")
                continue
        # retry document
        DocumentService.retry_document(dataset_id, retry_documents)

        return {'result': 'success'}, 204


class DocumentRenameApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(document_fields)
    def post(self, dataset_id, document_id):
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()
        dataset = DatasetService.get_dataset(dataset_id)
        DatasetService.check_dataset_operator_permission(current_user, dataset)
        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, nullable=False, location='json')
        args = parser.parse_args()

        try:
            document = DocumentService.rename_document(dataset_id, document_id, args['name'])
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError('Cannot delete document during indexing.')

        return document


class WebsiteDocumentSyncApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        """sync website document."""
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound('Dataset not found.')
        document_id = str(document_id)
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound('Document not found.')
        if document.tenant_id != current_user.current_tenant_id:
            raise Forbidden('No permission.')
        if document.data_source_type != 'website_crawl':
            raise ValueError('Document is not a website document.')
        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()
        # sync document
        DocumentService.sync_website_document(dataset_id, document)

        return {'result': 'success'}, 200


api.add_resource(GetProcessRuleApi, '/datasets/process-rule')
api.add_resource(DatasetDocumentListApi,
                 '/datasets/<uuid:dataset_id>/documents')
api.add_resource(DatasetInitApi,
                 '/datasets/init')
api.add_resource(DocumentIndexingEstimateApi,
                 '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/indexing-estimate')
api.add_resource(DocumentBatchIndexingEstimateApi,
                 '/datasets/<uuid:dataset_id>/batch/<string:batch>/indexing-estimate')
api.add_resource(DocumentBatchIndexingStatusApi,
                 '/datasets/<uuid:dataset_id>/batch/<string:batch>/indexing-status')
api.add_resource(DocumentIndexingStatusApi,
                 '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/indexing-status')
api.add_resource(DocumentDetailApi,
                 '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>')
api.add_resource(DocumentProcessingApi,
                 '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/<string:action>')
api.add_resource(DocumentDeleteApi,
                 '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>')
api.add_resource(DocumentMetadataApi,
                 '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/metadata')
api.add_resource(DocumentStatusApi,
                 '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/status/<string:action>')
api.add_resource(DocumentPauseApi, '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/pause')
api.add_resource(DocumentRecoverApi, '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/resume')
api.add_resource(DocumentRetryApi, '/datasets/<uuid:dataset_id>/retry')
api.add_resource(DocumentRenameApi,
                 '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/rename')

api.add_resource(WebsiteDocumentSyncApi, '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/website-sync')
