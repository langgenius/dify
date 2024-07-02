import flask_restful
from flask import current_app, request
from flask_login import current_user
from flask_restful import Resource, marshal, marshal_with, reqparse
from werkzeug.exceptions import Forbidden, NotFound

import services
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
from services.dataset_service import DatasetService, DocumentService


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 40:
        raise ValueError('Name must be between 1 to 40 characters.')
    return name


def _validate_description_length(description):
    if len(description) > 400:
        raise ValueError('Description cannot exceed 400 characters.')
    return description


class DatasetListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        page = request.args.get('page', default=1, type=int)
        limit = request.args.get('limit', default=20, type=int)
        ids = request.args.getlist('ids')
        provider = request.args.get('provider', default="vendor")
        search = request.args.get('keyword', default=None, type=str)
        tag_ids = request.args.getlist('tag_ids')

        if ids:
            datasets, total = DatasetService.get_datasets_by_ids(ids, current_user.current_tenant_id)
        else:
            datasets, total = DatasetService.get_datasets(page, limit, provider,
                                                          current_user.current_tenant_id, current_user, search, tag_ids)

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

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('name', nullable=False, required=True,
                            help='type is required. Name must be between 1 to 40 characters.',
                            type=_validate_name)
        parser.add_argument('indexing_technique', type=str, location='json',
                            choices=Dataset.INDEXING_TECHNIQUE_LIST,
                            nullable=True,
                            help='Invalid indexing technique.')
        args = parser.parse_args()

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        try:
            dataset = DatasetService.create_empty_dataset(
                tenant_id=current_user.current_tenant_id,
                name=args['name'],
                indexing_technique=args['indexing_technique'],
                account=current_user
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return marshal(dataset, dataset_detail_fields), 201


class DatasetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(
                dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        data = marshal(dataset, dataset_detail_fields)
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

        if data['indexing_technique'] == 'high_quality':
            item_model = f"{data['embedding_model']}:{data['embedding_model_provider']}"
            if item_model in model_names:
                data['embedding_available'] = True
            else:
                data['embedding_available'] = False
        else:
            data['embedding_available'] = True
        return data, 200

    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)

        parser = reqparse.RequestParser()
        parser.add_argument('name', nullable=False,
                            help='type is required. Name must be between 1 to 40 characters.',
                            type=_validate_name)
        parser.add_argument('description',
                            location='json', store_missing=False,
                            type=_validate_description_length)
        parser.add_argument('indexing_technique', type=str, location='json',
                            choices=Dataset.INDEXING_TECHNIQUE_LIST,
                            nullable=True,
                            help='Invalid indexing technique.')
        parser.add_argument('permission', type=str, location='json', choices=(
            'only_me', 'all_team_members'), help='Invalid permission.')
        parser.add_argument('embedding_model', type=str,
                            location='json', help='Invalid embedding model.')
        parser.add_argument('embedding_model_provider', type=str,
                            location='json', help='Invalid embedding model provider.')
        parser.add_argument('retrieval_model', type=dict, location='json', help='Invalid retrieval model.')
        args = parser.parse_args()

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        dataset = DatasetService.update_dataset(
            dataset_id_str, args, current_user)

        if dataset is None:
            raise NotFound("Dataset not found.")

        return marshal(dataset, dataset_detail_fields), 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, dataset_id):
        dataset_id_str = str(dataset_id)

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        try:
            if DatasetService.delete_dataset(dataset_id_str, current_user):
                return {'result': 'success'}, 204
            else:
                raise NotFound("Dataset not found.")
        except services.errors.dataset.DatasetInUseError:
            raise DatasetInUseError()

class DatasetUseCheckApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)

        dataset_is_using = DatasetService.dataset_use_check(dataset_id_str)
        return {'is_using': dataset_is_using}, 200

class DatasetQueryApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        page = request.args.get('page', default=1, type=int)
        limit = request.args.get('limit', default=20, type=int)

        dataset_queries, total = DatasetService.get_dataset_queries(
            dataset_id=dataset.id,
            page=page,
            per_page=limit
        )

        response = {
            'data': marshal(dataset_queries, dataset_query_detail_fields),
            'has_more': len(dataset_queries) == limit,
            'limit': limit,
            'total': total,
            'page': page
        }
        return response, 200


class DatasetIndexingEstimateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('info_list', type=dict, required=True, nullable=True, location='json')
        parser.add_argument('process_rule', type=dict, required=True, nullable=True, location='json')
        parser.add_argument('indexing_technique', type=str, required=True,
                            choices=Dataset.INDEXING_TECHNIQUE_LIST,
                            nullable=True, location='json')
        parser.add_argument('doc_form', type=str, default='text_model', required=False, nullable=False, location='json')
        parser.add_argument('dataset_id', type=str, required=False, nullable=False, location='json')
        parser.add_argument('doc_language', type=str, default='English', required=False, nullable=False,
                            location='json')
        args = parser.parse_args()
        # validate args
        DocumentService.estimate_args_validate(args)
        extract_settings = []
        if args['info_list']['data_source_type'] == 'upload_file':
            file_ids = args['info_list']['file_info_list']['file_ids']
            file_details = db.session.query(UploadFile).filter(
                UploadFile.tenant_id == current_user.current_tenant_id,
                UploadFile.id.in_(file_ids)
            ).all()

            if file_details is None:
                raise NotFound("File not found.")

            if file_details:
                for file_detail in file_details:
                    extract_setting = ExtractSetting(
                        datasource_type="upload_file",
                        upload_file=file_detail,
                        document_model=args['doc_form']
                    )
                    extract_settings.append(extract_setting)
        elif args['info_list']['data_source_type'] == 'notion_import':
            notion_info_list = args['info_list']['notion_info_list']
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
        elif args['info_list']['data_source_type'] == 'website_crawl':
            website_info_list = args['info_list']['website_info_list']
            for url in website_info_list['urls']:
                extract_setting = ExtractSetting(
                    datasource_type="website_crawl",
                    website_info={
                        "provider": website_info_list['provider'],
                        "job_id": website_info_list['job_id'],
                        "url": url,
                        "tenant_id": current_user.current_tenant_id,
                        "mode": 'crawl',
                        "only_main_content": website_info_list['only_main_content']
                    },
                    document_model=args['doc_form']
                )
                extract_settings.append(extract_setting)
        else:
            raise ValueError('Data source type not support')
        indexing_runner = IndexingRunner()
        try:
            response = indexing_runner.indexing_estimate(current_user.current_tenant_id, extract_settings,
                                                         args['process_rule'], args['doc_form'],
                                                         args['doc_language'], args['dataset_id'],
                                                         args['indexing_technique'])
        except LLMBadRequestError:
            raise ProviderNotInitializeError(
                "No Embedding Model available. Please configure a valid provider "
                "in the Settings -> Model Provider.")
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except Exception as e:
            raise IndexingEstimateError(str(e))

        return response, 200


class DatasetRelatedAppListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(related_app_list)
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        app_dataset_joins = DatasetService.get_related_apps(dataset.id)

        related_apps = []
        for app_dataset_join in app_dataset_joins:
            app_model = app_dataset_join.app
            if app_model:
                related_apps.append(app_model)

        return {
            'data': related_apps,
            'total': len(related_apps)
        }, 200


class DatasetIndexingStatusApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id = str(dataset_id)
        documents = db.session.query(Document).filter(
            Document.dataset_id == dataset_id,
            Document.tenant_id == current_user.current_tenant_id
        ).all()
        documents_status = []
        for document in documents:
            completed_segments = DocumentSegment.query.filter(DocumentSegment.completed_at.isnot(None),
                                                              DocumentSegment.document_id == str(document.id),
                                                              DocumentSegment.status != 're_segment').count()
            total_segments = DocumentSegment.query.filter(DocumentSegment.document_id == str(document.id),
                                                          DocumentSegment.status != 're_segment').count()
            document.completed_segments = completed_segments
            document.total_segments = total_segments
            documents_status.append(marshal(document, document_status_fields))
        data = {
            'data': documents_status
        }
        return data


class DatasetApiKeyApi(Resource):
    max_keys = 10
    token_prefix = 'dataset-'
    resource_type = 'dataset'

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_key_list)
    def get(self):
        keys = db.session.query(ApiToken). \
            filter(ApiToken.type == self.resource_type, ApiToken.tenant_id == current_user.current_tenant_id). \
            all()
        return {"items": keys}

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_key_fields)
    def post(self):
        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        current_key_count = db.session.query(ApiToken). \
            filter(ApiToken.type == self.resource_type, ApiToken.tenant_id == current_user.current_tenant_id). \
            count()

        if current_key_count >= self.max_keys:
            flask_restful.abort(
                400,
                message=f"Cannot create more than {self.max_keys} API keys for this resource type.",
                code='max_keys_exceeded'
            )

        key = ApiToken.generate_api_key(self.token_prefix, 24)
        api_token = ApiToken()
        api_token.tenant_id = current_user.current_tenant_id
        api_token.token = key
        api_token.type = self.resource_type
        db.session.add(api_token)
        db.session.commit()
        return api_token, 200


class DatasetApiDeleteApi(Resource):
    resource_type = 'dataset'

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, api_key_id):
        api_key_id = str(api_key_id)

        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        key = db.session.query(ApiToken). \
            filter(ApiToken.tenant_id == current_user.current_tenant_id, ApiToken.type == self.resource_type,
                   ApiToken.id == api_key_id). \
            first()

        if key is None:
            flask_restful.abort(404, message='API key not found')

        db.session.query(ApiToken).filter(ApiToken.id == api_key_id).delete()
        db.session.commit()

        return {'result': 'success'}, 204


class DatasetApiBaseUrlApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        return {
            'api_base_url': (current_app.config['SERVICE_API_URL'] if current_app.config['SERVICE_API_URL']
                             else request.host_url.rstrip('/')) + '/v1'
        }


class DatasetRetrievalSettingApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        vector_type = current_app.config['VECTOR_STORE']
        match vector_type:
            case VectorType.MILVUS | VectorType.RELYT | VectorType.PGVECTOR | VectorType.TIDB_VECTOR | VectorType.CHROMA | VectorType.TENCENT | VectorType.ORACLE:
                return {
                    'retrieval_method': [
                        RetrievalMethod.SEMANTIC_SEARCH
                    ]
                }
            case VectorType.QDRANT | VectorType.WEAVIATE | VectorType.OPENSEARCH:
                return {
                    'retrieval_method': [
                        RetrievalMethod.SEMANTIC_SEARCH,
                        RetrievalMethod.FULL_TEXT_SEARCH,
                        RetrievalMethod.HYBRID_SEARCH,
                    ]
                }
            case _:
                raise ValueError(f"Unsupported vector db type {vector_type}.")


class DatasetRetrievalSettingMockApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, vector_type):
        match vector_type:
            case VectorType.MILVUS | VectorType.RELYT | VectorType.PGVECTOR | VectorType.TIDB_VECTOR | VectorType.CHROMA | VectorType.TENCENT | VectorType.ORACLE:
                return {
                    'retrieval_method': [
                        RetrievalMethod.SEMANTIC_SEARCH
                    ]
                }
            case VectorType.QDRANT | VectorType.WEAVIATE | VectorType.OPENSEARCH:
                return {
                    'retrieval_method': [
                        RetrievalMethod.SEMANTIC_SEARCH,
                        RetrievalMethod.FULL_TEXT_SEARCH,
                        RetrievalMethod.HYBRID_SEARCH,
                    ]
                }
            case _:
                raise ValueError(f"Unsupported vector db type {vector_type}.")



class DatasetErrorDocs(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        results = DocumentService.get_error_documents_by_dataset_id(dataset_id_str)

        return {
            'data': [marshal(item, document_status_fields) for item in results],
            'total': len(results)
        }, 200


api.add_resource(DatasetListApi, '/datasets')
api.add_resource(DatasetApi, '/datasets/<uuid:dataset_id>')
api.add_resource(DatasetUseCheckApi, '/datasets/<uuid:dataset_id>/use-check')
api.add_resource(DatasetQueryApi, '/datasets/<uuid:dataset_id>/queries')
api.add_resource(DatasetErrorDocs, '/datasets/<uuid:dataset_id>/error-docs')
api.add_resource(DatasetIndexingEstimateApi, '/datasets/indexing-estimate')
api.add_resource(DatasetRelatedAppListApi, '/datasets/<uuid:dataset_id>/related-apps')
api.add_resource(DatasetIndexingStatusApi, '/datasets/<uuid:dataset_id>/indexing-status')
api.add_resource(DatasetApiKeyApi, '/datasets/api-keys')
api.add_resource(DatasetApiDeleteApi, '/datasets/api-keys/<uuid:api_key_id>')
api.add_resource(DatasetApiBaseUrlApi, '/datasets/api-base-info')
api.add_resource(DatasetRetrievalSettingApi, '/datasets/retrieval-setting')
api.add_resource(DatasetRetrievalSettingMockApi, '/datasets/retrieval-setting/<string:vector_type>')
