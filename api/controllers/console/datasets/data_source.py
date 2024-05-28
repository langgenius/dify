import datetime
import json

from flask import request
from flask_login import current_user
from flask_restful import Resource, marshal_with, reqparse
from werkzeug.exceptions import NotFound

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.indexing_runner import IndexingRunner
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.extractor.notion_extractor import NotionExtractor
from extensions.ext_database import db
from fields.data_source_fields import integrate_list_fields, integrate_notion_info_list_fields
from libs.login import login_required
from models.dataset import Document
from models.source import DataSourceBinding
from services.dataset_service import DatasetService, DocumentService
from tasks.document_indexing_sync_task import document_indexing_sync_task


class DataSourceApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(integrate_list_fields)
    def get(self):
        # get workspace data source integrates
        data_source_integrates = db.session.query(DataSourceBinding).filter(
            DataSourceBinding.tenant_id == current_user.current_tenant_id,
            DataSourceBinding.disabled == False
        ).all()

        base_url = request.url_root.rstrip('/')
        data_source_oauth_base_path = "/console/api/oauth/data-source"
        providers = ["notion"]

        integrate_data = []
        for provider in providers:
            # existing_integrate = next((ai for ai in data_source_integrates if ai.provider == provider), None)
            existing_integrates = filter(lambda item: item.provider == provider, data_source_integrates)
            if existing_integrates:
                for existing_integrate in list(existing_integrates):
                    integrate_data.append({
                        'id': existing_integrate.id,
                        'provider': provider,
                        'created_at': existing_integrate.created_at,
                        'is_bound': True,
                        'disabled': existing_integrate.disabled,
                        'source_info': existing_integrate.source_info,
                        'link': f'{base_url}{data_source_oauth_base_path}/{provider}'
                })
            else:
                integrate_data.append({
                    'id': None,
                    'provider': provider,
                    'created_at': None,
                    'source_info': None,
                    'is_bound': False,
                    'disabled': None,
                    'link': f'{base_url}{data_source_oauth_base_path}/{provider}'
                })
        return {'data': integrate_data}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, binding_id, action):
        binding_id = str(binding_id)
        action = str(action)
        data_source_binding = DataSourceBinding.query.filter_by(
            id=binding_id
        ).first()
        if data_source_binding is None:
            raise NotFound('Data source binding not found.')
        # enable binding
        if action == 'enable':
            if data_source_binding.disabled:
                data_source_binding.disabled = False
                data_source_binding.updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                db.session.add(data_source_binding)
                db.session.commit()
            else:
                raise ValueError('Data source is not disabled.')
        # disable binding
        if action == 'disable':
            if not data_source_binding.disabled:
                data_source_binding.disabled = True
                data_source_binding.updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                db.session.add(data_source_binding)
                db.session.commit()
            else:
                raise ValueError('Data source is disabled.')
        return {'result': 'success'}, 200


class DataSourceNotionListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(integrate_notion_info_list_fields)
    def get(self):
        dataset_id = request.args.get('dataset_id', default=None, type=str)
        exist_page_ids = []
        # import notion in the exist dataset
        if dataset_id:
            dataset = DatasetService.get_dataset(dataset_id)
            if not dataset:
                raise NotFound('Dataset not found.')
            if dataset.data_source_type != 'notion_import':
                raise ValueError('Dataset is not notion type.')
            documents = Document.query.filter_by(
                dataset_id=dataset_id,
                tenant_id=current_user.current_tenant_id,
                data_source_type='notion_import',
                enabled=True
            ).all()
            if documents:
                for document in documents:
                    data_source_info = json.loads(document.data_source_info)
                    exist_page_ids.append(data_source_info['notion_page_id'])
        # get all authorized pages
        data_source_bindings = DataSourceBinding.query.filter_by(
            tenant_id=current_user.current_tenant_id,
            provider='notion',
            disabled=False
        ).all()
        if not data_source_bindings:
            return {
                'notion_info': []
            }, 200
        pre_import_info_list = []
        for data_source_binding in data_source_bindings:
            source_info = data_source_binding.source_info
            pages = source_info['pages']
            # Filter out already bound pages
            for page in pages:
                if page['page_id'] in exist_page_ids:
                    page['is_bound'] = True
                else:
                    page['is_bound'] = False
            pre_import_info = {
                'workspace_name': source_info['workspace_name'],
                'workspace_icon': source_info['workspace_icon'],
                'workspace_id': source_info['workspace_id'],
                'pages': pages,
            }
            pre_import_info_list.append(pre_import_info)
        return {
            'notion_info': pre_import_info_list
        }, 200


class DataSourceNotionApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, workspace_id, page_id, page_type):
        workspace_id = str(workspace_id)
        page_id = str(page_id)
        data_source_binding = DataSourceBinding.query.filter(
            db.and_(
                DataSourceBinding.tenant_id == current_user.current_tenant_id,
                DataSourceBinding.provider == 'notion',
                DataSourceBinding.disabled == False,
                DataSourceBinding.source_info['workspace_id'] == f'"{workspace_id}"'
            )
        ).first()
        if not data_source_binding:
            raise NotFound('Data source binding not found.')

        extractor = NotionExtractor(
            notion_workspace_id=workspace_id,
            notion_obj_id=page_id,
            notion_page_type=page_type,
            notion_access_token=data_source_binding.access_token,
            tenant_id=current_user.current_tenant_id
        )

        text_docs = extractor.extract()
        return {
            'content': "\n".join([doc.page_content for doc in text_docs])
        }, 200

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('notion_info_list', type=list, required=True, nullable=True, location='json')
        parser.add_argument('process_rule', type=dict, required=True, nullable=True, location='json')
        parser.add_argument('doc_form', type=str, default='text_model', required=False, nullable=False, location='json')
        parser.add_argument('doc_language', type=str, default='English', required=False, nullable=False, location='json')
        args = parser.parse_args()
        # validate args
        DocumentService.estimate_args_validate(args)
        notion_info_list = args['notion_info_list']
        extract_settings = []
        for notion_info in notion_info_list:
            workspace_id = notion_info['workspace_id']
            for page in notion_info['pages']:
                extract_setting = ExtractSetting(
                    datasource_type="notion_import",
                    notion_info={
                        "notion_workspace_id": workspace_id,
                        "notion_obj_id": page['page_id'],
                        "notion_page_type": page['type'],
                        "tenant_id": current_user.current_tenant_id
                    },
                    document_model=args['doc_form']
                )
                extract_settings.append(extract_setting)
        indexing_runner = IndexingRunner()
        response = indexing_runner.indexing_estimate(current_user.current_tenant_id, extract_settings,
                                                     args['process_rule'], args['doc_form'],
                                                     args['doc_language'])
        return response, 200


class DataSourceNotionDatasetSyncApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        documents = DocumentService.get_document_by_dataset_id(dataset_id_str)
        for document in documents:
            document_indexing_sync_task.delay(dataset_id_str, document.id)
        return 200


class DataSourceNotionDocumentSyncApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        document = DocumentService.get_document(dataset_id_str, document_id_str)
        if document is None:
            raise NotFound("Document not found.")
        document_indexing_sync_task.delay(dataset_id_str, document_id_str)
        return 200


api.add_resource(DataSourceApi, '/data-source/integrates', '/data-source/integrates/<uuid:binding_id>/<string:action>')
api.add_resource(DataSourceNotionListApi, '/notion/pre-import/pages')
api.add_resource(DataSourceNotionApi,
                 '/notion/workspaces/<uuid:workspace_id>/pages/<uuid:page_id>/<string:page_type>/preview',
                 '/datasets/notion-indexing-estimate')
api.add_resource(DataSourceNotionDatasetSyncApi, '/datasets/<uuid:dataset_id>/notion/sync')
api.add_resource(DataSourceNotionDocumentSyncApi, '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/notion/sync')
