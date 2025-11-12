from typing import Any, cast

from flask import request
from flask_restx import Resource, fields, marshal, marshal_with, reqparse
from sqlalchemy import select
from werkzeug.exceptions import Forbidden, NotFound

import services
from configs import dify_config
from controllers.console import api, console_ns
from controllers.console.apikey import api_key_fields, api_key_list
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import DatasetInUseError, DatasetNameDuplicateError, IndexingEstimateError
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    enterprise_license_required,
    setup_required,
)
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.indexing_runner import IndexingRunner
from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.rag.extractor.entity.extract_setting import ExtractSetting, NotionInfo, WebsiteInfo
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from fields.app_fields import related_app_list
from fields.dataset_fields import dataset_detail_fields, dataset_query_detail_fields
from fields.document_fields import document_status_fields
from libs.login import current_account_with_tenant, login_required
from libs.validators import validate_description_length
from models import ApiToken, Dataset, Document, DocumentSegment, UploadFile
from models.dataset import DatasetPermissionEnum
from models.provider_ids import ModelProviderID
from services.dataset_service import DatasetPermissionService, DatasetService, DocumentService


def _validate_name(name: str) -> str:
    if not name or len(name) < 1 or len(name) > 40:
        raise ValueError("Name must be between 1 to 40 characters.")
    return name


def _get_retrieval_methods_by_vector_type(vector_type: str | None, is_mock: bool = False) -> dict[str, list[str]]:
    """
    Get supported retrieval methods based on vector database type.

    Args:
        vector_type: Vector database type, can be None
        is_mock: Whether this is a Mock API, affects MILVUS handling

    Returns:
        Dictionary containing supported retrieval methods

    Raises:
        ValueError: If vector_type is None or unsupported
    """
    if vector_type is None:
        raise ValueError("Vector store type is not configured.")

    # Define vector database types that only support semantic search
    semantic_only_types = {
        VectorType.RELYT,
        VectorType.TIDB_VECTOR,
        VectorType.CHROMA,
        VectorType.PGVECTO_RS,
        VectorType.VIKINGDB,
        VectorType.UPSTASH,
    }

    # Define vector database types that support all retrieval methods
    full_search_types = {
        VectorType.QDRANT,
        VectorType.WEAVIATE,
        VectorType.OPENSEARCH,
        VectorType.ANALYTICDB,
        VectorType.MYSCALE,
        VectorType.ORACLE,
        VectorType.ELASTICSEARCH,
        VectorType.ELASTICSEARCH_JA,
        VectorType.PGVECTOR,
        VectorType.VASTBASE,
        VectorType.TIDB_ON_QDRANT,
        VectorType.LINDORM,
        VectorType.COUCHBASE,
        VectorType.OPENGAUSS,
        VectorType.OCEANBASE,
        VectorType.TABLESTORE,
        VectorType.HUAWEI_CLOUD,
        VectorType.TENCENT,
        VectorType.MATRIXONE,
        VectorType.CLICKZETTA,
        VectorType.BAIDU,
        VectorType.ALIBABACLOUD_MYSQL,
    }

    semantic_methods = {"retrieval_method": [RetrievalMethod.SEMANTIC_SEARCH.value]}
    full_methods = {
        "retrieval_method": [
            RetrievalMethod.SEMANTIC_SEARCH.value,
            RetrievalMethod.FULL_TEXT_SEARCH.value,
            RetrievalMethod.HYBRID_SEARCH.value,
        ]
    }

    if vector_type == VectorType.MILVUS:
        return semantic_methods if is_mock else full_methods

    if vector_type in semantic_only_types:
        return semantic_methods
    elif vector_type in full_search_types:
        return full_methods
    else:
        raise ValueError(f"Unsupported vector db type {vector_type}.")


@console_ns.route("/datasets")
class DatasetListApi(Resource):
    @api.doc("get_datasets")
    @api.doc(description="Get list of datasets")
    @api.doc(
        params={
            "page": "Page number (default: 1)",
            "limit": "Number of items per page (default: 20)",
            "ids": "Filter by dataset IDs (list)",
            "keyword": "Search keyword",
            "tag_ids": "Filter by tag IDs (list)",
            "include_all": "Include all datasets (default: false)",
        }
    )
    @api.response(200, "Datasets retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        ids = request.args.getlist("ids")
        # provider = request.args.get("provider", default="vendor")
        search = request.args.get("keyword", default=None, type=str)
        tag_ids = request.args.getlist("tag_ids")
        include_all = request.args.get("include_all", default="false").lower() == "true"
        if ids:
            datasets, total = DatasetService.get_datasets_by_ids(ids, current_tenant_id)
        else:
            datasets, total = DatasetService.get_datasets(
                page, limit, current_tenant_id, current_user, search, tag_ids, include_all
            )

        # check embedding setting
        provider_manager = ProviderManager()
        configurations = provider_manager.get_configurations(tenant_id=current_tenant_id)

        embedding_models = configurations.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        data = cast(list[dict[str, Any]], marshal(datasets, dataset_detail_fields))
        for item in data:
            # convert embedding_model_provider to plugin standard format
            if item["indexing_technique"] == "high_quality" and item["embedding_model_provider"]:
                item["embedding_model_provider"] = str(ModelProviderID(item["embedding_model_provider"]))
                item_model = f"{item['embedding_model']}:{item['embedding_model_provider']}"
                if item_model in model_names:
                    item["embedding_available"] = True
                else:
                    item["embedding_available"] = False
            else:
                item["embedding_available"] = True

            if item.get("permission") == "partial_members":
                part_users_list = DatasetPermissionService.get_dataset_partial_member_list(item["id"])
                item.update({"partial_member_list": part_users_list})
            else:
                item.update({"partial_member_list": []})

        response = {"data": data, "has_more": len(datasets) == limit, "limit": limit, "total": total, "page": page}
        return response, 200

    @api.doc("create_dataset")
    @api.doc(description="Create a new dataset")
    @api.expect(
        api.model(
            "CreateDatasetRequest",
            {
                "name": fields.String(required=True, description="Dataset name (1-40 characters)"),
                "description": fields.String(description="Dataset description (max 400 characters)"),
                "indexing_technique": fields.String(description="Indexing technique"),
                "permission": fields.String(description="Dataset permission"),
                "provider": fields.String(description="Provider"),
                "external_knowledge_api_id": fields.String(description="External knowledge API ID"),
                "external_knowledge_id": fields.String(description="External knowledge ID"),
            },
        )
    )
    @api.response(201, "Dataset created successfully")
    @api.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument(
                "name",
                nullable=False,
                required=True,
                help="type is required. Name must be between 1 to 40 characters.",
                type=_validate_name,
            )
            .add_argument(
                "description",
                type=validate_description_length,
                nullable=True,
                required=False,
                default="",
            )
            .add_argument(
                "indexing_technique",
                type=str,
                location="json",
                choices=Dataset.INDEXING_TECHNIQUE_LIST,
                nullable=True,
                help="Invalid indexing technique.",
            )
            .add_argument(
                "external_knowledge_api_id",
                type=str,
                nullable=True,
                required=False,
            )
            .add_argument(
                "provider",
                type=str,
                nullable=True,
                choices=Dataset.PROVIDER_LIST,
                required=False,
                default="vendor",
            )
            .add_argument(
                "external_knowledge_id",
                type=str,
                nullable=True,
                required=False,
            )
        )
        args = parser.parse_args()
        current_user, current_tenant_id = current_account_with_tenant()

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            dataset = DatasetService.create_empty_dataset(
                tenant_id=current_tenant_id,
                name=args["name"],
                description=args["description"],
                indexing_technique=args["indexing_technique"],
                account=current_user,
                permission=DatasetPermissionEnum.ONLY_ME,
                provider=args["provider"],
                external_knowledge_api_id=args["external_knowledge_api_id"],
                external_knowledge_id=args["external_knowledge_id"],
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return marshal(dataset, dataset_detail_fields), 201


@console_ns.route("/datasets/<uuid:dataset_id>")
class DatasetApi(Resource):
    @api.doc("get_dataset")
    @api.doc(description="Get dataset details")
    @api.doc(params={"dataset_id": "Dataset ID"})
    @api.response(200, "Dataset retrieved successfully", dataset_detail_fields)
    @api.response(404, "Dataset not found")
    @api.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        current_user, current_tenant_id = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        data = cast(dict[str, Any], marshal(dataset, dataset_detail_fields))
        if dataset.indexing_technique == "high_quality":
            if dataset.embedding_model_provider:
                provider_id = ModelProviderID(dataset.embedding_model_provider)
                data["embedding_model_provider"] = str(provider_id)
        if data.get("permission") == "partial_members":
            part_users_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str)
            data.update({"partial_member_list": part_users_list})

        # check embedding setting
        provider_manager = ProviderManager()
        configurations = provider_manager.get_configurations(tenant_id=current_tenant_id)

        embedding_models = configurations.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        if data["indexing_technique"] == "high_quality":
            item_model = f"{data['embedding_model']}:{data['embedding_model_provider']}"
            if item_model in model_names:
                data["embedding_available"] = True
            else:
                data["embedding_available"] = False
        else:
            data["embedding_available"] = True

        return data, 200

    @api.doc("update_dataset")
    @api.doc(description="Update dataset details")
    @api.expect(
        api.model(
            "UpdateDatasetRequest",
            {
                "name": fields.String(description="Dataset name"),
                "description": fields.String(description="Dataset description"),
                "permission": fields.String(description="Dataset permission"),
                "indexing_technique": fields.String(description="Indexing technique"),
                "external_retrieval_model": fields.Raw(description="External retrieval model settings"),
            },
        )
    )
    @api.response(200, "Dataset updated successfully", dataset_detail_fields)
    @api.response(404, "Dataset not found")
    @api.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        parser = (
            reqparse.RequestParser()
            .add_argument(
                "name",
                nullable=False,
                help="type is required. Name must be between 1 to 40 characters.",
                type=_validate_name,
            )
            .add_argument("description", location="json", store_missing=False, type=validate_description_length)
            .add_argument(
                "indexing_technique",
                type=str,
                location="json",
                choices=Dataset.INDEXING_TECHNIQUE_LIST,
                nullable=True,
                help="Invalid indexing technique.",
            )
            .add_argument(
                "permission",
                type=str,
                location="json",
                choices=(
                    DatasetPermissionEnum.ONLY_ME,
                    DatasetPermissionEnum.ALL_TEAM,
                    DatasetPermissionEnum.PARTIAL_TEAM,
                ),
                help="Invalid permission.",
            )
            .add_argument("embedding_model", type=str, location="json", help="Invalid embedding model.")
            .add_argument(
                "embedding_model_provider", type=str, location="json", help="Invalid embedding model provider."
            )
            .add_argument("retrieval_model", type=dict, location="json", help="Invalid retrieval model.")
            .add_argument("partial_member_list", type=list, location="json", help="Invalid parent user list.")
            .add_argument(
                "external_retrieval_model",
                type=dict,
                required=False,
                nullable=True,
                location="json",
                help="Invalid external retrieval model.",
            )
            .add_argument(
                "external_knowledge_id",
                type=str,
                required=False,
                nullable=True,
                location="json",
                help="Invalid external knowledge id.",
            )
            .add_argument(
                "external_knowledge_api_id",
                type=str,
                required=False,
                nullable=True,
                location="json",
                help="Invalid external knowledge api id.",
            )
            .add_argument(
                "icon_info",
                type=dict,
                required=False,
                nullable=True,
                location="json",
                help="Invalid icon info.",
            )
        )
        args = parser.parse_args()
        data = request.get_json()
        current_user, current_tenant_id = current_account_with_tenant()

        # check embedding model setting
        if (
            data.get("indexing_technique") == "high_quality"
            and data.get("embedding_model_provider") is not None
            and data.get("embedding_model") is not None
        ):
            DatasetService.check_embedding_model_setting(
                dataset.tenant_id, data.get("embedding_model_provider"), data.get("embedding_model")
            )

        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        DatasetPermissionService.check_permission(
            current_user, dataset, data.get("permission"), data.get("partial_member_list")
        )

        dataset = DatasetService.update_dataset(dataset_id_str, args, current_user)

        if dataset is None:
            raise NotFound("Dataset not found.")

        result_data = cast(dict[str, Any], marshal(dataset, dataset_detail_fields))
        tenant_id = current_tenant_id

        if data.get("partial_member_list") and data.get("permission") == "partial_members":
            DatasetPermissionService.update_partial_member_list(
                tenant_id, dataset_id_str, data.get("partial_member_list")
            )
        # clear partial member list when permission is only_me or all_team_members
        elif (
            data.get("permission") == DatasetPermissionEnum.ONLY_ME
            or data.get("permission") == DatasetPermissionEnum.ALL_TEAM
        ):
            DatasetPermissionService.clear_partial_member_list(dataset_id_str)

        partial_member_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str)
        result_data.update({"partial_member_list": partial_member_list})

        return result_data, 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def delete(self, dataset_id):
        dataset_id_str = str(dataset_id)
        current_user, _ = current_account_with_tenant()

        if not (current_user.has_edit_permission or current_user.is_dataset_operator):
            raise Forbidden()

        try:
            if DatasetService.delete_dataset(dataset_id_str, current_user):
                DatasetPermissionService.clear_partial_member_list(dataset_id_str)
                return {"result": "success"}, 204
            else:
                raise NotFound("Dataset not found.")
        except services.errors.dataset.DatasetInUseError:
            raise DatasetInUseError()


@console_ns.route("/datasets/<uuid:dataset_id>/use-check")
class DatasetUseCheckApi(Resource):
    @api.doc("check_dataset_use")
    @api.doc(description="Check if dataset is in use")
    @api.doc(params={"dataset_id": "Dataset ID"})
    @api.response(200, "Dataset use status retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)

        dataset_is_using = DatasetService.dataset_use_check(dataset_id_str)
        return {"is_using": dataset_is_using}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/queries")
class DatasetQueryApi(Resource):
    @api.doc("get_dataset_queries")
    @api.doc(description="Get dataset query history")
    @api.doc(params={"dataset_id": "Dataset ID"})
    @api.response(200, "Query history retrieved successfully", dataset_query_detail_fields)
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        current_user, _ = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)

        dataset_queries, total = DatasetService.get_dataset_queries(dataset_id=dataset.id, page=page, per_page=limit)

        response = {
            "data": marshal(dataset_queries, dataset_query_detail_fields),
            "has_more": len(dataset_queries) == limit,
            "limit": limit,
            "total": total,
            "page": page,
        }
        return response, 200


@console_ns.route("/datasets/indexing-estimate")
class DatasetIndexingEstimateApi(Resource):
    @api.doc("estimate_dataset_indexing")
    @api.doc(description="Estimate dataset indexing cost")
    @api.response(200, "Indexing estimate calculated successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("info_list", type=dict, required=True, nullable=True, location="json")
            .add_argument("process_rule", type=dict, required=True, nullable=True, location="json")
            .add_argument(
                "indexing_technique",
                type=str,
                required=True,
                choices=Dataset.INDEXING_TECHNIQUE_LIST,
                nullable=True,
                location="json",
            )
            .add_argument("doc_form", type=str, default="text_model", required=False, nullable=False, location="json")
            .add_argument("dataset_id", type=str, required=False, nullable=False, location="json")
            .add_argument("doc_language", type=str, default="English", required=False, nullable=False, location="json")
        )
        args = parser.parse_args()
        _, current_tenant_id = current_account_with_tenant()
        # validate args
        DocumentService.estimate_args_validate(args)
        extract_settings = []
        if args["info_list"]["data_source_type"] == "upload_file":
            file_ids = args["info_list"]["file_info_list"]["file_ids"]
            file_details = db.session.scalars(
                select(UploadFile).where(UploadFile.tenant_id == current_tenant_id, UploadFile.id.in_(file_ids))
            ).all()

            if file_details is None:
                raise NotFound("File not found.")

            if file_details:
                for file_detail in file_details:
                    extract_setting = ExtractSetting(
                        datasource_type=DatasourceType.FILE,
                        upload_file=file_detail,
                        document_model=args["doc_form"],
                    )
                    extract_settings.append(extract_setting)
        elif args["info_list"]["data_source_type"] == "notion_import":
            notion_info_list = args["info_list"]["notion_info_list"]
            for notion_info in notion_info_list:
                workspace_id = notion_info["workspace_id"]
                credential_id = notion_info.get("credential_id")
                for page in notion_info["pages"]:
                    extract_setting = ExtractSetting(
                        datasource_type=DatasourceType.NOTION,
                        notion_info=NotionInfo.model_validate(
                            {
                                "credential_id": credential_id,
                                "notion_workspace_id": workspace_id,
                                "notion_obj_id": page["page_id"],
                                "notion_page_type": page["type"],
                                "tenant_id": current_tenant_id,
                            }
                        ),
                        document_model=args["doc_form"],
                    )
                    extract_settings.append(extract_setting)
        elif args["info_list"]["data_source_type"] == "website_crawl":
            website_info_list = args["info_list"]["website_info_list"]
            for url in website_info_list["urls"]:
                extract_setting = ExtractSetting(
                    datasource_type=DatasourceType.WEBSITE,
                    website_info=WebsiteInfo.model_validate(
                        {
                            "provider": website_info_list["provider"],
                            "job_id": website_info_list["job_id"],
                            "url": url,
                            "tenant_id": current_tenant_id,
                            "mode": "crawl",
                            "only_main_content": website_info_list["only_main_content"],
                        }
                    ),
                    document_model=args["doc_form"],
                )
                extract_settings.append(extract_setting)
        else:
            raise ValueError("Data source type not support")
        indexing_runner = IndexingRunner()
        try:
            response = indexing_runner.indexing_estimate(
                current_tenant_id,
                extract_settings,
                args["process_rule"],
                args["doc_form"],
                args["doc_language"],
                args["dataset_id"],
                args["indexing_technique"],
            )
        except LLMBadRequestError:
            raise ProviderNotInitializeError(
                "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except Exception as e:
            raise IndexingEstimateError(str(e))

        return response.model_dump(), 200


@console_ns.route("/datasets/<uuid:dataset_id>/related-apps")
class DatasetRelatedAppListApi(Resource):
    @api.doc("get_dataset_related_apps")
    @api.doc(description="Get applications related to dataset")
    @api.doc(params={"dataset_id": "Dataset ID"})
    @api.response(200, "Related apps retrieved successfully", related_app_list)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(related_app_list)
    def get(self, dataset_id):
        current_user, _ = current_account_with_tenant()
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

        return {"data": related_apps, "total": len(related_apps)}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/indexing-status")
class DatasetIndexingStatusApi(Resource):
    @api.doc("get_dataset_indexing_status")
    @api.doc(description="Get dataset indexing status")
    @api.doc(params={"dataset_id": "Dataset ID"})
    @api.response(200, "Indexing status retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        _, current_tenant_id = current_account_with_tenant()
        dataset_id = str(dataset_id)
        documents = db.session.scalars(
            select(Document).where(Document.dataset_id == dataset_id, Document.tenant_id == current_tenant_id)
        ).all()
        documents_status = []
        for document in documents:
            completed_segments = (
                db.session.query(DocumentSegment)
                .where(
                    DocumentSegment.completed_at.isnot(None),
                    DocumentSegment.document_id == str(document.id),
                    DocumentSegment.status != "re_segment",
                )
                .count()
            )
            total_segments = (
                db.session.query(DocumentSegment)
                .where(DocumentSegment.document_id == str(document.id), DocumentSegment.status != "re_segment")
                .count()
            )
            # Create a dictionary with document attributes and additional fields
            document_dict = {
                "id": document.id,
                "indexing_status": document.indexing_status,
                "processing_started_at": document.processing_started_at,
                "parsing_completed_at": document.parsing_completed_at,
                "cleaning_completed_at": document.cleaning_completed_at,
                "splitting_completed_at": document.splitting_completed_at,
                "completed_at": document.completed_at,
                "paused_at": document.paused_at,
                "error": document.error,
                "stopped_at": document.stopped_at,
                "completed_segments": completed_segments,
                "total_segments": total_segments,
            }
            documents_status.append(marshal(document_dict, document_status_fields))
        data = {"data": documents_status}
        return data, 200


@console_ns.route("/datasets/api-keys")
class DatasetApiKeyApi(Resource):
    max_keys = 10
    token_prefix = "dataset-"
    resource_type = "dataset"

    @api.doc("get_dataset_api_keys")
    @api.doc(description="Get dataset API keys")
    @api.response(200, "API keys retrieved successfully", api_key_list)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_key_list)
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        keys = db.session.scalars(
            select(ApiToken).where(ApiToken.type == self.resource_type, ApiToken.tenant_id == current_tenant_id)
        ).all()
        return {"items": keys}

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_key_fields)
    def post(self):
        # The role of the current user in the ta table must be admin or owner
        current_user, current_tenant_id = current_account_with_tenant()
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        current_key_count = (
            db.session.query(ApiToken)
            .where(ApiToken.type == self.resource_type, ApiToken.tenant_id == current_tenant_id)
            .count()
        )

        if current_key_count >= self.max_keys:
            api.abort(
                400,
                message=f"Cannot create more than {self.max_keys} API keys for this resource type.",
                code="max_keys_exceeded",
            )

        key = ApiToken.generate_api_key(self.token_prefix, 24)
        api_token = ApiToken()
        api_token.tenant_id = current_tenant_id
        api_token.token = key
        api_token.type = self.resource_type
        db.session.add(api_token)
        db.session.commit()
        return api_token, 200


@console_ns.route("/datasets/api-keys/<uuid:api_key_id>")
class DatasetApiDeleteApi(Resource):
    resource_type = "dataset"

    @api.doc("delete_dataset_api_key")
    @api.doc(description="Delete dataset API key")
    @api.doc(params={"api_key_id": "API key ID"})
    @api.response(204, "API key deleted successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, api_key_id):
        current_user, current_tenant_id = current_account_with_tenant()
        api_key_id = str(api_key_id)

        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        key = (
            db.session.query(ApiToken)
            .where(
                ApiToken.tenant_id == current_tenant_id,
                ApiToken.type == self.resource_type,
                ApiToken.id == api_key_id,
            )
            .first()
        )

        if key is None:
            api.abort(404, message="API key not found")

        db.session.query(ApiToken).where(ApiToken.id == api_key_id).delete()
        db.session.commit()

        return {"result": "success"}, 204


@console_ns.route("/datasets/<uuid:dataset_id>/api-keys/<string:status>")
class DatasetEnableApiApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, dataset_id, status):
        dataset_id_str = str(dataset_id)

        DatasetService.update_dataset_api_status(dataset_id_str, status == "enable")

        return {"result": "success"}, 200


@console_ns.route("/datasets/api-base-info")
class DatasetApiBaseUrlApi(Resource):
    @api.doc("get_dataset_api_base_info")
    @api.doc(description="Get dataset API base information")
    @api.response(200, "API base info retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        return {"api_base_url": (dify_config.SERVICE_API_URL or request.host_url.rstrip("/")) + "/v1"}


@console_ns.route("/datasets/retrieval-setting")
class DatasetRetrievalSettingApi(Resource):
    @api.doc("get_dataset_retrieval_setting")
    @api.doc(description="Get dataset retrieval settings")
    @api.response(200, "Retrieval settings retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        vector_type = dify_config.VECTOR_STORE
        return _get_retrieval_methods_by_vector_type(vector_type, is_mock=False)


@console_ns.route("/datasets/retrieval-setting/<string:vector_type>")
class DatasetRetrievalSettingMockApi(Resource):
    @api.doc("get_dataset_retrieval_setting_mock")
    @api.doc(description="Get mock dataset retrieval settings by vector type")
    @api.doc(params={"vector_type": "Vector store type"})
    @api.response(200, "Mock retrieval settings retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, vector_type):
        return _get_retrieval_methods_by_vector_type(vector_type, is_mock=True)


@console_ns.route("/datasets/<uuid:dataset_id>/error-docs")
class DatasetErrorDocs(Resource):
    @api.doc("get_dataset_error_docs")
    @api.doc(description="Get dataset error documents")
    @api.doc(params={"dataset_id": "Dataset ID"})
    @api.response(200, "Error documents retrieved successfully")
    @api.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        results = DocumentService.get_error_documents_by_dataset_id(dataset_id_str)

        return {"data": [marshal(item, document_status_fields) for item in results], "total": len(results)}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/permission-part-users")
class DatasetPermissionUserListApi(Resource):
    @api.doc("get_dataset_permission_users")
    @api.doc(description="Get dataset permission user list")
    @api.doc(params={"dataset_id": "Dataset ID"})
    @api.response(200, "Permission users retrieved successfully")
    @api.response(404, "Dataset not found")
    @api.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        current_user, _ = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        partial_members_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str)

        return {
            "data": partial_members_list,
        }, 200


@console_ns.route("/datasets/<uuid:dataset_id>/auto-disable-logs")
class DatasetAutoDisableLogApi(Resource):
    @api.doc("get_dataset_auto_disable_logs")
    @api.doc(description="Get dataset auto disable logs")
    @api.doc(params={"dataset_id": "Dataset ID"})
    @api.response(200, "Auto disable logs retrieved successfully")
    @api.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        return DatasetService.get_dataset_auto_disable_logs(dataset_id_str), 200
