import datetime
import hashlib
import json
import tempfile
import time
import uuid
from pathlib import Path

from cachetools import TTLCache
from flask import request, current_app
from flask_login import login_required, current_user
from flask_restful import Resource, marshal_with, fields
from werkzeug.exceptions import NotFound

from controllers.console import api
from controllers.console.datasets.error import NoFileUploadedError, TooManyFilesError, FileTooLargeError, \
    UnsupportedFileTypeError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.index.readers.html_parser import HTMLParser
from core.index.readers.pdf_parser import PDFParser
from extensions.ext_storage import storage
from libs.helper import TimestampField
from extensions.ext_database import db
from libs.oauth_data_source import NotionOAuth
from models.dataset import Document
from models.model import UploadFile
from models.source import DataSourceBinding
from services.dataset_service import DatasetService, DocumentService

cache = TTLCache(maxsize=None, ttl=30)

FILE_SIZE_LIMIT = 15 * 1024 * 1024  # 15MB
ALLOWED_EXTENSIONS = ['txt', 'markdown', 'md', 'pdf', 'html', 'htm']
PREVIEW_WORDS_LIMIT = 3000


class DataSourceApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
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

        return {'data': integrate_data}

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


class DataSourceNotionApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
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
            pages = NotionOAuth.get_authorized_pages(data_source_binding.access_token)
            # Filter out already bound pages
            filter_pages = filter(lambda page: page['page_id'] not in exist_page_ids, pages)
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


api.add_resource(DataSourceApi, '/oauth/data-source/integrates')
api.add_resource(DataSourceApi, '/oauth/data-source/integrates/<uuid:binding_id>/<string:action>')
api.add_resource(DataSourceNotionApi, '/notion/pre-import/pages')

