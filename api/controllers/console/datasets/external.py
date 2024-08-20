import flask_restful
from flask import request
from flask_login import current_user
from flask_restful import Resource, marshal, marshal_with, reqparse
from werkzeug.exceptions import Forbidden, NotFound

import services
from configs import dify_config
from controllers.console import api
from controllers.console.apikey import api_key_fields, api_key_list
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import DatasetInUseError, DatasetNameDuplicateError, IndexingEstimateError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.indexing_runner import IndexingRunner
from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.retrieval.retrival_methods import RetrievalMethod
from extensions.ext_database import db
from fields.app_fields import related_app_list
from fields.dataset_fields import dataset_detail_fields, dataset_query_detail_fields
from fields.document_fields import document_status_fields
from libs.login import login_required
from models.dataset import Dataset, Document, DocumentSegment
from models.model import ApiToken, UploadFile
from services.dataset_service import DatasetPermissionService, DatasetService, DocumentService
from services.external_knowledge_service import ExternalDatasetService


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 100:
        raise ValueError('Name must be between 1 to 100 characters.')
    return name

def _validate_description_length(description):
    if len(description) > 400:
        raise ValueError('Description cannot exceed 400 characters.')
    return description

class ExternalApiTemplateListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        page = request.args.get('page', default=1, type=int)
        limit = request.args.get('limit', default=20, type=int)
        search = request.args.get('keyword', default=None, type=str)

        api_templates, total = ExternalDatasetService.get_external_api_templates(
            page,
            limit,
            current_user.current_tenant_id,
            search
        )
        response = {
            'data': [item.to_dict() for item in api_templates],
            'has_more': len(api_templates) == limit,
            'limit': limit,
            'total': total,
            'page': page
        }
        return response, 200

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('name', nullable=False, required=True,
                            help='type is required. Name must be between 1 to 100 characters.',
                            type=_validate_name)
        parser.add_argument('settings', type=list, location='json',
                            nullable=False,
                            required=True, )
        args = parser.parse_args()

        ExternalDatasetService.validate_api_list(args['settings'])

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            api_template = ExternalDatasetService.create_api_template(
                tenant_id=current_user.current_tenant_id,
                user_id=current_user.id,
                args=args
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return api_template.to_dict(), 201


class ExternalApiTemplateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, api_template_id):
        api_template_id = str(api_template_id)
        api_template = ExternalDatasetService.get_api_template(api_template_id)
        if api_template is None:
            raise NotFound("API template not found.")

        return api_template.to_dict(), 200

    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, api_template_id):
        api_template_id = str(api_template_id)

        parser = reqparse.RequestParser()
        parser.add_argument('name', nullable=False, required=True,
                            help='type is required. Name must be between 1 to 100 characters.',
                            type=_validate_name)
        parser.add_argument('settings', type=list, location='json',
                            nullable=False,
                            required=True, )
        args = parser.parse_args()
        ExternalDatasetService.validate_api_list(args['settings'])

        api_template = ExternalDatasetService.update_api_template(
            tenant_id=current_user.current_tenant_id,
            user_id=current_user.id,
            api_template_id=api_template_id,
            args=args
        )

        return api_template.to_dict(), 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, api_template_id):
        api_template_id = str(api_template_id)

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor or current_user.is_dataset_operator:
            raise Forbidden()

        ExternalDatasetService.delete_api_template(current_user.current_tenant_id, api_template_id)
        return {'result': 'success'}, 204


class ExternalApiUseCheckApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, api_template_id):
        api_template_id = str(api_template_id)

        external_api_template_is_using = ExternalDatasetService.external_api_template_use_check(api_template_id)
        return {'is_using': external_api_template_is_using}, 200


class ExternalDatasetInitApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('api_template_id', type=str, required=True, nullable=True, location='json')
        parser.add_argument('name', nullable=False, required=True,
                            help='name is required. Name must be between 1 to 100 characters.',
                            type=_validate_name)
        parser.add_argument('description', type=str, required=True, nullable=True, location='json')
        parser.add_argument('data_source', type=dict, required=True, nullable=True, location='json')
        parser.add_argument('process_parameter', type=dict, required=True, nullable=True, location='json')

        args = parser.parse_args()

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        # validate args
        ExternalDatasetService.document_create_args_validate(
            current_user.current_tenant_id,
            args['api_template_id'],
            args['process_parameter']
        )

        try:
            dataset, documents, batch = ExternalDatasetService.init_external_dataset(
                tenant_id=current_user.current_tenant_id,
                user_id=current_user.id,
                args=args,
            )
        except Exception as ex:
            raise ProviderNotInitializeError(ex.description)
        response = {
            'dataset': dataset,
            'documents': documents,
            'batch': batch
        }

        return response


api.add_resource(ExternalApiTemplateListApi, '/datasets/external-api-template')
api.add_resource(ExternalApiTemplateApi, '/datasets/external-api-template/<uuid:api_template_id>')
api.add_resource(ExternalApiUseCheckApi, '/datasets/external-api-template/<uuid:api_template_id>/use-check')

