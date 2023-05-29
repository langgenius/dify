import datetime
import json


from cachetools import TTLCache
from flask import request, current_app
from flask_login import login_required, current_user
from flask_restful import Resource, marshal_with, fields, reqparse, marshal
from werkzeug.exceptions import NotFound

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.data_source.notion import NotionPageReader
from core.indexing_runner import IndexingRunner
from extensions.ext_database import db
from libs.helper import TimestampField
from libs.oauth_data_source import NotionOAuth
from models.dataset import Document
from models.source import DataSourceBinding
from services.dataset_service import DatasetService, DocumentService

cache = TTLCache(maxsize=None, ttl=30)

FILE_SIZE_LIMIT = 15 * 1024 * 1024  # 15MB
ALLOWED_EXTENSIONS = ['txt', 'markdown', 'md', 'pdf', 'html', 'htm']
PREVIEW_WORDS_LIMIT = 3000


class DataSourceApi(Resource):

    integrate_page_fields = {
        'page_name': fields.String,
        'page_id': fields.String,
        'page_icon': fields.String,
        'total': fields.Integer
    }
    integrate_workspace_fields = {
        'workspace_name': fields.String,
        'workspace_id': fields.String,
        'workspace_icon': fields.String,
        'pages': fields.List(fields.Nested(integrate_page_fields))
    }
    integrate_fields = {
        'id': fields.String,
        'provider': fields.String,
        'created_at': TimestampField,
        'is_bound': fields.Boolean,
        'disabled': fields.Boolean,
        'link': fields.String,
        'source_info': fields.Nested(integrate_workspace_fields)
    }
    integrate_list_fields = {
        'data': fields.List(fields.Nested(integrate_fields)),
    }

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
            existing_integrate = next((ai for ai in data_source_integrates if ai.provider == provider), None)
            if existing_integrate:
                integrate_data.append({
                    'id': existing_integrate.id,
                    'provider': provider,
                    'created_at': existing_integrate.created_at,
                    'is_bound': True,
                    'disabled': existing_integrate.disabled,
                    'source_info': json.loads(existing_integrate.source_info),
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
        data_source_binding = DataSourceBinding.query.filter_by(
            id=binding_id
        ).first()
        if data_source_binding is None:
            raise NotFound('Data source binding not found.')
        # enable binding
        if action == 'enable':
            if data_source_binding.disabled:
                data_source_binding.disabled = False
                data_source_binding.updated_at = datetime.datetime.utcnow()
                db.session.add(data_source_binding)
                db.session.commit()
            else:
                raise ValueError('Data source is not disabled.')
        # disable binding
        if action == 'disable':
            if not data_source_binding.disabled:
                data_source_binding.disabled = True
                data_source_binding.updated_at = datetime.datetime.utcnow()
                db.session.add(data_source_binding)
                db.session.commit()
            else:
                raise ValueError('Data source is disabled.')
        return {'result': 'success'}, 200


class DataSourceNotionListApi(Resource):
    integrate_page_fields = {
        'page_name': fields.String,
        'page_id': fields.String,
        'page_icon': fields.String
    }
    integrate_workspace_fields = {
        'workspace_name': fields.String,
        'workspace_id': fields.String,
        'workspace_icon': fields.String,
        'pages': fields.List(fields.Nested(integrate_page_fields))
    }
    integrate_notion_info_list_fields = {
        'notion_info': fields.List(fields.Nested(integrate_workspace_fields)),
    }

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
            if dataset.data_source_type != 'notion':
                raise ValueError('Dataset is not notion type.')
            documents = Document.query.filter_by(
                dataset_id=dataset_id,
                tenant_id=current_user.current_tenant_id,
                data_source_type='notion',
                enabled=True
            ).all()
            if documents:
                page_ids = list(map(lambda item: item.data_source_info, documents))
                exist_page_ids.append(page_ids)
        # get all authorized pages
        data_source_bindings = DataSourceBinding.query.filter_by(
            tenant_id=current_user.current_tenant_id,
            provider='notion',
            disabled=False
        ).all()
        if not data_source_bindings:
            raise NotFound('Data source binding not found.')
        pre_import_info_list = []
        for data_source_binding in data_source_bindings:
            notion_oauth = NotionOAuth(client_id=current_app.config.get('NOTION_CLIENT_ID'),
                                       client_secret=current_app.config.get(
                                           'NOTION_CLIENT_SECRET'),
                                       redirect_uri=current_app.config.get(
                                           'CONSOLE_URL') + '/console/api/oauth/data-source/authorize/notion')
            pages = notion_oauth.get_authorized_pages(data_source_binding.access_token)
            # Filter out already bound pages
            filter_pages = [page for page in pages if page['page_id'] not in exist_page_ids]
            source_info = json.loads(data_source_binding.source_info)
            pre_import_info = {
                'workspace_name': source_info['workspace_name'],
                'workspace_icon': source_info['workspace_icon'],
                'workspace_id': source_info['workspace_id'],
                'pages': filter_pages,
            }
            pre_import_info_list.append(pre_import_info)
        return {
            'notion_info': pre_import_info_list
        }, 200


class DataSourceNotionApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, workspace_id, page_id):
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
        reader = NotionPageReader(integration_token=data_source_binding.access_token)
        page_content = reader.read_page(page_id)
        return {
            'content': page_content
        }, 200

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('notion_info_list', type=list, required=True, nullable=True, location='json')
        parser.add_argument('process_rule', type=dict, required=True, nullable=True, location='json')
        args = parser.parse_args()
        # validate args
        DocumentService.notion_estimate_args_validate(args)
        indexing_runner = IndexingRunner()
        response = indexing_runner.notion_indexing_estimate(args['notion_info_list'], args['process_rule'])
        return response, 200


api.add_resource(DataSourceApi, '/data-source/integrates', '/data-source/integrates/<uuid:binding_id>/<string:action>')
api.add_resource(DataSourceNotionListApi, '/notion/pre-import/pages')
api.add_resource(DataSourceNotionApi, '/notion/workspaces/<uuid:workspace_id>/pages/<uuid:page_id>/preview',
                 '/datasets/notion-indexing-estimate')
