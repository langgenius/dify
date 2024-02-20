from flask import request
from flask_restful import marshal, reqparse

import services.dataset_service
from controllers.service_api import api
from controllers.service_api.dataset.error import DatasetNameDuplicateError
from controllers.service_api.wraps import DatasetApiResource
from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager
from fields.dataset_fields import dataset_detail_fields
from libs.login import current_user
from models.dataset import Dataset
from services.dataset_service import DatasetService


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 40:
        raise ValueError('Name must be between 1 to 40 characters.')
    return name


class DatasetApi(DatasetApiResource):
    """Resource for get datasets."""

    def get(self, tenant_id):
        page = request.args.get('page', default=1, type=int)
        limit = request.args.get('limit', default=20, type=int)
        provider = request.args.get('provider', default="vendor")
        datasets, total = DatasetService.get_datasets(page, limit, provider,
                                                      tenant_id, current_user)
        # check embedding setting
        provider_manager = ProviderManager()
        configurations = provider_manager.get_configurations(
            tenant_id=current_user.current_tenant_id
        )

        embedding_models = configurations.get_models(
            model_type=ModelType.TEXT_EMBEDDING,
            only_active=True
        )

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        data = marshal(datasets, dataset_detail_fields)
        for item in data:
            if item['indexing_technique'] == 'high_quality':
                item_model = f"{item['embedding_model']}:{item['embedding_model_provider']}"
                if item_model in model_names:
                    item['embedding_available'] = True
                else:
                    item['embedding_available'] = False
            else:
                item['embedding_available'] = True
        response = {
            'data': data,
            'has_more': len(datasets) == limit,
            'limit': limit,
            'total': total,
            'page': page
        }
        return response, 200

    """Resource for datasets."""

    def post(self, tenant_id):
        parser = reqparse.RequestParser()
        parser.add_argument('name', nullable=False, required=True,
                            help='type is required. Name must be between 1 to 40 characters.',
                            type=_validate_name)
        parser.add_argument('indexing_technique', type=str, location='json',
                            choices=Dataset.INDEXING_TECHNIQUE_LIST,
                            help='Invalid indexing technique.')
        args = parser.parse_args()

        try:
            dataset = DatasetService.create_empty_dataset(
                tenant_id=tenant_id,
                name=args['name'],
                indexing_technique=args['indexing_technique'],
                account=current_user
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return marshal(dataset, dataset_detail_fields), 200


api.add_resource(DatasetApi, '/datasets')

