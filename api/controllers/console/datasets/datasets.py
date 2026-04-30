import json
from typing import Any, cast
from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource, fields, marshal, marshal_with
from graphon.model_runtime.entities.model_entities import ModelType
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

import services
from configs import dify_config
from controllers.common.schema import get_or_create_model, register_schema_models
from controllers.console import console_ns
from controllers.console.apikey import ApiKeyItem, ApiKeyList
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import DatasetInUseError, DatasetNameDuplicateError, IndexingEstimateError
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    enterprise_license_required,
    is_admin_or_owner_required,
    setup_required,
)
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.evaluation.entities.evaluation_entity import EvaluationCategory, EvaluationConfigData, EvaluationRunRequest
from core.indexing_runner import IndexingRunner
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.rag.extractor.entity.extract_setting import ExtractSetting, NotionInfo, WebsiteInfo
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from extensions.ext_storage import storage
from fields.app_fields import app_detail_kernel_fields, related_app_list
from fields.dataset_fields import (
    content_fields,
    dataset_detail_fields,
    dataset_fields,
    dataset_query_detail_fields,
    dataset_retrieval_model_fields,
    doc_metadata_fields,
    external_knowledge_info_fields,
    external_retrieval_model_fields,
    file_info_fields,
    icon_info_fields,
    keyword_setting_fields,
    reranking_model_fields,
    tag_fields,
    vector_setting_fields,
    weighted_score_fields,
)
from fields.document_fields import document_status_fields
from libs.login import current_account_with_tenant, login_required
from libs.url_utils import normalize_api_base_url
from models import ApiToken, Dataset, Document, DocumentSegment, EvaluationRun, EvaluationTargetType, UploadFile
from models.dataset import DatasetPermission, DatasetPermissionEnum
from models.enums import ApiTokenType, SegmentStatus
from models.provider_ids import ModelProviderID
from services.api_token_service import ApiTokenCache
from services.dataset_service import DatasetPermissionService, DatasetService, DocumentService
from services.errors.evaluation import (
    EvaluationDatasetInvalidError,
    EvaluationFrameworkNotConfiguredError,
    EvaluationMaxConcurrentRunsError,
    EvaluationNotFoundError,
)
from services.evaluation_service import EvaluationService

# Register models for flask_restx to avoid dict type issues in Swagger
dataset_base_model = get_or_create_model("DatasetBase", dataset_fields)

tag_model = get_or_create_model("Tag", tag_fields)

keyword_setting_model = get_or_create_model("DatasetKeywordSetting", keyword_setting_fields)
vector_setting_model = get_or_create_model("DatasetVectorSetting", vector_setting_fields)

weighted_score_fields_copy = weighted_score_fields.copy()
weighted_score_fields_copy["keyword_setting"] = fields.Nested(keyword_setting_model)
weighted_score_fields_copy["vector_setting"] = fields.Nested(vector_setting_model)
weighted_score_model = get_or_create_model("DatasetWeightedScore", weighted_score_fields_copy)

reranking_model = get_or_create_model("DatasetRerankingModel", reranking_model_fields)

dataset_retrieval_model_fields_copy = dataset_retrieval_model_fields.copy()
dataset_retrieval_model_fields_copy["reranking_model"] = fields.Nested(reranking_model)
dataset_retrieval_model_fields_copy["weights"] = fields.Nested(weighted_score_model, allow_null=True)
dataset_retrieval_model = get_or_create_model("DatasetRetrievalModel", dataset_retrieval_model_fields_copy)

external_knowledge_info_model = get_or_create_model("ExternalKnowledgeInfo", external_knowledge_info_fields)

external_retrieval_model = get_or_create_model("ExternalRetrievalModel", external_retrieval_model_fields)

doc_metadata_model = get_or_create_model("DatasetDocMetadata", doc_metadata_fields)

icon_info_model = get_or_create_model("DatasetIconInfo", icon_info_fields)

dataset_detail_fields_copy = dataset_detail_fields.copy()
dataset_detail_fields_copy["retrieval_model_dict"] = fields.Nested(dataset_retrieval_model)
dataset_detail_fields_copy["tags"] = fields.List(fields.Nested(tag_model))
dataset_detail_fields_copy["external_knowledge_info"] = fields.Nested(external_knowledge_info_model)
dataset_detail_fields_copy["external_retrieval_model"] = fields.Nested(external_retrieval_model, allow_null=True)
dataset_detail_fields_copy["doc_metadata"] = fields.List(fields.Nested(doc_metadata_model))
dataset_detail_fields_copy["icon_info"] = fields.Nested(icon_info_model)
dataset_detail_model = get_or_create_model("DatasetDetail", dataset_detail_fields_copy)

file_info_model = get_or_create_model("DatasetFileInfo", file_info_fields)

content_fields_copy = content_fields.copy()
content_fields_copy["file_info"] = fields.Nested(file_info_model, allow_null=True)
content_model = get_or_create_model("DatasetContent", content_fields_copy)

dataset_query_detail_fields_copy = dataset_query_detail_fields.copy()
dataset_query_detail_fields_copy["queries"] = fields.Nested(content_model)
dataset_query_detail_model = get_or_create_model("DatasetQueryDetail", dataset_query_detail_fields_copy)

app_detail_kernel_model = get_or_create_model("AppDetailKernel", app_detail_kernel_fields)
related_app_list_copy = related_app_list.copy()
related_app_list_copy["data"] = fields.List(fields.Nested(app_detail_kernel_model))
related_app_list_model = get_or_create_model("RelatedAppList", related_app_list_copy)


def _validate_indexing_technique(value: str | None) -> str | None:
    if value is None:
        return value
    if value not in Dataset.INDEXING_TECHNIQUE_LIST:
        raise ValueError("Invalid indexing technique.")
    return value


def _validate_doc_form(value: str | None) -> str | None:
    if value is None:
        return value
    if value not in Dataset.DOC_FORM_LIST:
        raise ValueError("Invalid doc_form.")
    return value


class DatasetCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    description: str = Field("", max_length=400)
    indexing_technique: str | None = None
    permission: DatasetPermissionEnum | None = DatasetPermissionEnum.ONLY_ME
    provider: str = "vendor"
    external_knowledge_api_id: str | None = None
    external_knowledge_id: str | None = None

    @field_validator("indexing_technique")
    @classmethod
    def validate_indexing(cls, value: str | None) -> str | None:
        return _validate_indexing_technique(value)

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, value: str) -> str:
        if value not in Dataset.PROVIDER_LIST:
            raise ValueError("Invalid provider.")
        return value


class DatasetUpdatePayload(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=40)
    description: str | None = Field(None, max_length=400)
    permission: DatasetPermissionEnum | None = None
    indexing_technique: str | None = None
    embedding_model: str | None = None
    embedding_model_provider: str | None = None
    retrieval_model: dict[str, Any] | None = None
    summary_index_setting: dict[str, Any] | None = None
    partial_member_list: list[dict[str, str]] | None = None
    external_retrieval_model: dict[str, Any] | None = None
    external_knowledge_id: str | None = None
    external_knowledge_api_id: str | None = None
    icon_info: dict[str, Any] | None = None
    is_multimodal: bool | None = False

    @field_validator("indexing_technique")
    @classmethod
    def validate_indexing(cls, value: str | None) -> str | None:
        return _validate_indexing_technique(value)


class IndexingEstimatePayload(BaseModel):
    info_list: dict[str, Any]
    process_rule: dict[str, Any]
    indexing_technique: str
    doc_form: str = "text_model"
    dataset_id: str | None = None
    doc_language: str = "English"

    @field_validator("indexing_technique")
    @classmethod
    def validate_indexing(cls, value: str) -> str:
        result = _validate_indexing_technique(value)
        if result is None:
            raise ValueError("indexing_technique is required.")
        return result

    @field_validator("doc_form")
    @classmethod
    def validate_doc_form(cls, value: str) -> str:
        result = _validate_doc_form(value)
        if result is None:
            return "text_model"
        return result


class ConsoleDatasetListQuery(BaseModel):
    page: int = Field(default=1, description="Page number")
    limit: int = Field(default=20, description="Number of items per page")
    keyword: str | None = Field(default=None, description="Search keyword")
    include_all: bool = Field(default=False, description="Include all datasets")
    ids: list[str] = Field(default_factory=list, description="Filter by dataset IDs")
    tag_ids: list[str] = Field(default_factory=list, description="Filter by tag IDs")


register_schema_models(
    console_ns, DatasetCreatePayload, DatasetUpdatePayload, IndexingEstimatePayload, ConsoleDatasetListQuery
)


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
        VectorType.SEEKDB,
        VectorType.TABLESTORE,
        VectorType.HUAWEI_CLOUD,
        VectorType.TENCENT,
        VectorType.MATRIXONE,
        VectorType.CLICKZETTA,
        VectorType.BAIDU,
        VectorType.ALIBABACLOUD_MYSQL,
        VectorType.IRIS,
        VectorType.HOLOGRES,
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
    @console_ns.doc("get_datasets")
    @console_ns.doc(description="Get list of datasets")
    @console_ns.doc(
        params={
            "page": "Page number (default: 1)",
            "limit": "Number of items per page (default: 20)",
            "ids": "Filter by dataset IDs (list)",
            "keyword": "Search keyword",
            "tag_ids": "Filter by tag IDs (list)",
            "include_all": "Include all datasets (default: false)",
        }
    )
    @console_ns.response(200, "Datasets retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        # Convert query parameters to dict, handling list parameters correctly
        query_params: dict[str, str | list[str]] = dict(request.args.to_dict())
        # Handle ids and tag_ids as lists (Flask request.args.getlist returns list even for single value)
        if "ids" in request.args:
            query_params["ids"] = request.args.getlist("ids")
        if "tag_ids" in request.args:
            query_params["tag_ids"] = request.args.getlist("tag_ids")
        query = ConsoleDatasetListQuery.model_validate(query_params)
        # provider = request.args.get("provider", default="vendor")
        if query.ids:
            datasets, total = DatasetService.get_datasets_by_ids(query.ids, current_tenant_id)
        else:
            datasets, total = DatasetService.get_datasets(
                query.page,
                query.limit,
                current_tenant_id,
                current_user,
                query.keyword,
                query.tag_ids,
                query.include_all,
            )

        # check embedding setting
        provider_manager = create_plugin_provider_manager(tenant_id=current_tenant_id)
        configurations = provider_manager.get_configurations(tenant_id=current_tenant_id)

        embedding_models = configurations.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        data = cast(list[dict[str, Any]], marshal(datasets, dataset_detail_fields))
        dataset_ids = [item["id"] for item in data if item.get("permission") == "partial_members"]
        partial_members_map: dict[str, list[str]] = {}
        if dataset_ids:
            permissions = db.session.execute(
                select(DatasetPermission.dataset_id, DatasetPermission.account_id).where(
                    DatasetPermission.dataset_id.in_(dataset_ids)
                )
            ).all()

            for dataset_id, account_id in permissions:
                partial_members_map.setdefault(dataset_id, []).append(account_id)

        for item in data:
            # convert embedding_model_provider to plugin standard format
            if item["indexing_technique"] == IndexTechniqueType.HIGH_QUALITY and item["embedding_model_provider"]:
                item["embedding_model_provider"] = str(ModelProviderID(item["embedding_model_provider"]))
                item_model = f"{item['embedding_model']}:{item['embedding_model_provider']}"
                if item_model in model_names:
                    item["embedding_available"] = True
                else:
                    item["embedding_available"] = False
            else:
                item["embedding_available"] = True

            if item.get("permission") == "partial_members":
                item.update({"partial_member_list": partial_members_map.get(item["id"], [])})
            else:
                item.update({"partial_member_list": []})

        response = {
            "data": data,
            "has_more": len(datasets) == query.limit,
            "limit": query.limit,
            "total": total,
            "page": query.page,
        }
        return response, 200

    @console_ns.doc("create_dataset")
    @console_ns.doc(description="Create a new dataset")
    @console_ns.expect(console_ns.models[DatasetCreatePayload.__name__])
    @console_ns.response(201, "Dataset created successfully")
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self):
        payload = DatasetCreatePayload.model_validate(console_ns.payload or {})
        current_user, current_tenant_id = current_account_with_tenant()

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            dataset = DatasetService.create_empty_dataset(
                tenant_id=current_tenant_id,
                name=payload.name,
                description=payload.description,
                indexing_technique=payload.indexing_technique,
                account=current_user,
                permission=payload.permission or DatasetPermissionEnum.ONLY_ME,
                provider=payload.provider,
                external_knowledge_api_id=payload.external_knowledge_api_id,
                external_knowledge_id=payload.external_knowledge_id,
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return marshal(dataset, dataset_detail_fields), 201


@console_ns.route("/datasets/<uuid:dataset_id>")
class DatasetApi(Resource):
    @console_ns.doc("get_dataset")
    @console_ns.doc(description="Get dataset details")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(200, "Dataset retrieved successfully", dataset_detail_model)
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(403, "Permission denied")
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
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            if dataset.embedding_model_provider:
                provider_id = ModelProviderID(dataset.embedding_model_provider)
                data["embedding_model_provider"] = str(provider_id)
        if data.get("permission") == "partial_members":
            part_users_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str)
            data.update({"partial_member_list": part_users_list})

        # check embedding setting
        provider_manager = create_plugin_provider_manager(tenant_id=current_tenant_id)
        configurations = provider_manager.get_configurations(tenant_id=current_tenant_id)

        embedding_models = configurations.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        if data["indexing_technique"] == IndexTechniqueType.HIGH_QUALITY:
            item_model = f"{data['embedding_model']}:{data['embedding_model_provider']}"
            if item_model in model_names:
                data["embedding_available"] = True
            else:
                data["embedding_available"] = False
        else:
            data["embedding_available"] = True

        return data, 200

    @console_ns.doc("update_dataset")
    @console_ns.doc(description="Update dataset details")
    @console_ns.expect(console_ns.models[DatasetUpdatePayload.__name__])
    @console_ns.response(200, "Dataset updated successfully", dataset_detail_model)
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        payload = DatasetUpdatePayload.model_validate(console_ns.payload or {})
        current_user, current_tenant_id = current_account_with_tenant()
        # check embedding model setting
        if (
            payload.indexing_technique == IndexTechniqueType.HIGH_QUALITY
            and payload.embedding_model_provider is not None
            and payload.embedding_model is not None
        ):
            is_multimodal = DatasetService.check_is_multimodal_model(
                dataset.tenant_id, payload.embedding_model_provider, payload.embedding_model
            )
            payload.is_multimodal = is_multimodal
        payload_data = payload.model_dump(exclude_unset=True)
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        DatasetPermissionService.check_permission(
            current_user, dataset, payload.permission, payload.partial_member_list
        )

        dataset = DatasetService.update_dataset(dataset_id_str, payload_data, current_user)

        if dataset is None:
            raise NotFound("Dataset not found.")

        result_data = cast(dict[str, Any], marshal(dataset, dataset_detail_fields))
        tenant_id = current_tenant_id

        if payload.partial_member_list is not None and payload.permission == DatasetPermissionEnum.PARTIAL_TEAM:
            DatasetPermissionService.update_partial_member_list(tenant_id, dataset_id_str, payload.partial_member_list)
        # clear partial member list when permission is only_me or all_team_members
        elif payload.permission in {DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.ALL_TEAM}:
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
    @console_ns.doc("check_dataset_use")
    @console_ns.doc(description="Check if dataset is in use")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(200, "Dataset use status retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)

        dataset_is_using = DatasetService.dataset_use_check(dataset_id_str)
        return {"is_using": dataset_is_using}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/queries")
class DatasetQueryApi(Resource):
    @console_ns.doc("get_dataset_queries")
    @console_ns.doc(description="Get dataset query history")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(200, "Query history retrieved successfully", dataset_query_detail_model)
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
            "data": marshal(dataset_queries, dataset_query_detail_model),
            "has_more": len(dataset_queries) == limit,
            "limit": limit,
            "total": total,
            "page": page,
        }
        return response, 200


@console_ns.route("/datasets/indexing-estimate")
class DatasetIndexingEstimateApi(Resource):
    @console_ns.doc("estimate_dataset_indexing")
    @console_ns.doc(description="Estimate dataset indexing cost")
    @console_ns.response(200, "Indexing estimate calculated successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.expect(console_ns.models[IndexingEstimatePayload.__name__])
    def post(self):
        payload = IndexingEstimatePayload.model_validate(console_ns.payload or {})
        args = payload.model_dump()
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
    @console_ns.doc("get_dataset_related_apps")
    @console_ns.doc(description="Get applications related to dataset")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(200, "Related apps retrieved successfully", related_app_list_model)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(related_app_list_model)
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
    @console_ns.doc("get_dataset_indexing_status")
    @console_ns.doc(description="Get dataset indexing status")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(200, "Indexing status retrieved successfully")
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
                db.session.scalar(
                    select(func.count(DocumentSegment.id)).where(
                        DocumentSegment.completed_at.isnot(None),
                        DocumentSegment.document_id == str(document.id),
                        DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                    )
                )
                or 0
            )
            total_segments = (
                db.session.scalar(
                    select(func.count(DocumentSegment.id)).where(
                        DocumentSegment.document_id == str(document.id),
                        DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                    )
                )
                or 0
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
    resource_type = ApiTokenType.DATASET

    @console_ns.doc("get_dataset_api_keys")
    @console_ns.doc(description="Get dataset API keys")
    @console_ns.response(200, "API keys retrieved successfully", console_ns.models[ApiKeyList.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        keys = db.session.scalars(
            select(ApiToken).where(ApiToken.type == self.resource_type, ApiToken.tenant_id == current_tenant_id)
        ).all()
        return ApiKeyList.model_validate({"data": keys}, from_attributes=True).model_dump(mode="json")

    @console_ns.response(200, "API key created successfully", console_ns.models[ApiKeyItem.__name__])
    @console_ns.response(400, "Maximum keys exceeded")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        _, current_tenant_id = current_account_with_tenant()

        current_key_count = (
            db.session.scalar(
                select(func.count(ApiToken.id)).where(
                    ApiToken.type == self.resource_type, ApiToken.tenant_id == current_tenant_id
                )
            )
            or 0
        )

        if current_key_count >= self.max_keys:
            console_ns.abort(
                400,
                message=f"Cannot create more than {self.max_keys} API keys for this resource type.",
                custom="max_keys_exceeded",
            )

        key = ApiToken.generate_api_key(self.token_prefix, 24)
        api_token = ApiToken()
        api_token.tenant_id = current_tenant_id
        api_token.token = key
        api_token.type = self.resource_type
        db.session.add(api_token)
        db.session.commit()
        return ApiKeyItem.model_validate(api_token, from_attributes=True).model_dump(mode="json"), 200


@console_ns.route("/datasets/api-keys/<uuid:api_key_id>")
class DatasetApiDeleteApi(Resource):
    resource_type = ApiTokenType.DATASET

    @console_ns.doc("delete_dataset_api_key")
    @console_ns.doc(description="Delete dataset API key")
    @console_ns.doc(params={"api_key_id": "API key ID"})
    @console_ns.response(204, "API key deleted successfully")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def delete(self, api_key_id):
        _, current_tenant_id = current_account_with_tenant()
        api_key_id = str(api_key_id)
        key = db.session.scalar(
            select(ApiToken)
            .where(
                ApiToken.tenant_id == current_tenant_id,
                ApiToken.type == self.resource_type,
                ApiToken.id == api_key_id,
            )
            .limit(1)
        )

        if key is None:
            console_ns.abort(404, message="API key not found")

        # Invalidate cache before deleting from database
        # Type assertion: key is guaranteed to be non-None here because abort() raises
        assert key is not None  # nosec - for type checker only
        ApiTokenCache.delete(key.token, key.type)

        db.session.delete(key)
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
    @console_ns.doc("get_dataset_api_base_info")
    @console_ns.doc(description="Get dataset API base information")
    @console_ns.response(200, "API base info retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        base = dify_config.SERVICE_API_URL or request.host_url.rstrip("/")
        return {"api_base_url": normalize_api_base_url(base)}


@console_ns.route("/datasets/retrieval-setting")
class DatasetRetrievalSettingApi(Resource):
    @console_ns.doc("get_dataset_retrieval_setting")
    @console_ns.doc(description="Get dataset retrieval settings")
    @console_ns.response(200, "Retrieval settings retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        vector_type = dify_config.VECTOR_STORE
        return _get_retrieval_methods_by_vector_type(vector_type, is_mock=False)


@console_ns.route("/datasets/retrieval-setting/<string:vector_type>")
class DatasetRetrievalSettingMockApi(Resource):
    @console_ns.doc("get_dataset_retrieval_setting_mock")
    @console_ns.doc(description="Get mock dataset retrieval settings by vector type")
    @console_ns.doc(params={"vector_type": "Vector store type"})
    @console_ns.response(200, "Mock retrieval settings retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, vector_type):
        return _get_retrieval_methods_by_vector_type(vector_type, is_mock=True)


@console_ns.route("/datasets/<uuid:dataset_id>/error-docs")
class DatasetErrorDocs(Resource):
    @console_ns.doc("get_dataset_error_docs")
    @console_ns.doc(description="Get dataset error documents")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(200, "Error documents retrieved successfully")
    @console_ns.response(404, "Dataset not found")
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
    @console_ns.doc("get_dataset_permission_users")
    @console_ns.doc(description="Get dataset permission user list")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(200, "Permission users retrieved successfully")
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(403, "Permission denied")
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
    @console_ns.doc("get_dataset_auto_disable_logs")
    @console_ns.doc(description="Get dataset auto disable logs")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(200, "Auto disable logs retrieved successfully")
    @console_ns.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        return DatasetService.get_dataset_auto_disable_logs(dataset_id_str), 200


# ---- Knowledge Base Retrieval Evaluation ----


def _serialize_dataset_evaluation_run(run: EvaluationRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "tenant_id": run.tenant_id,
        "target_type": run.target_type,
        "target_id": run.target_id,
        "evaluation_config_id": run.evaluation_config_id,
        "status": run.status,
        "dataset_file_id": run.dataset_file_id,
        "result_file_id": run.result_file_id,
        "total_items": run.total_items,
        "completed_items": run.completed_items,
        "failed_items": run.failed_items,
        "progress": run.progress,
        "metrics_summary": json.loads(run.metrics_summary) if run.metrics_summary else {},
        "error": run.error,
        "created_by": run.created_by,
        "started_at": int(run.started_at.timestamp()) if run.started_at else None,
        "completed_at": int(run.completed_at.timestamp()) if run.completed_at else None,
        "created_at": int(run.created_at.timestamp()) if run.created_at else None,
    }


def _serialize_dataset_evaluation_run_item(item: Any) -> dict[str, Any]:
    return {
        "id": item.id,
        "item_index": item.item_index,
        "inputs": item.inputs_dict,
        "expected_output": item.expected_output,
        "actual_output": item.actual_output,
        "metrics": item.metrics_list,
        "judgment": item.judgment_dict,
        "metadata": item.metadata_dict,
        "error": item.error,
        "overall_score": item.overall_score,
    }


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/template/download")
class DatasetEvaluationTemplateDownloadApi(Resource):
    @console_ns.doc("download_dataset_evaluation_template")
    @console_ns.response(200, "Template file streamed as XLSX attachment")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, dataset_id):
        """Download evaluation dataset template for knowledge base retrieval."""
        current_user, _ = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        xlsx_content, filename = EvaluationService.generate_retrieval_dataset_template()
        encoded_filename = quote(filename)
        response = Response(
            xlsx_content,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
        response.headers["Content-Length"] = str(len(xlsx_content))
        return response


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation")
class DatasetEvaluationDetailApi(Resource):
    @console_ns.doc("get_dataset_evaluation_config")
    @console_ns.response(200, "Evaluation configuration retrieved")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        """Get evaluation configuration for the knowledge base."""
        current_user, current_tenant_id = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        with Session(db.engine, expire_on_commit=False) as session:
            config = EvaluationService.get_evaluation_config(
                session, current_tenant_id, "dataset", dataset_id_str
            )

        if config is None:
            return {
                "evaluation_model": None,
                "evaluation_model_provider": None,
                "default_metrics": None,
                "customized_metrics": None,
                "judgment_config": None,
            }

        return {
            "evaluation_model": config.evaluation_model,
            "evaluation_model_provider": config.evaluation_model_provider,
            "default_metrics": config.default_metrics_list,
            "customized_metrics": config.customized_metrics_dict,
            "judgment_config": config.judgment_config_dict,
        }

    @console_ns.doc("save_dataset_evaluation_config")
    @console_ns.response(200, "Evaluation configuration saved")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    def put(self, dataset_id):
        """Save evaluation configuration for the knowledge base."""
        current_user, current_tenant_id = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        body = request.get_json(force=True)
        try:
            config_data = EvaluationConfigData.model_validate(body)
        except Exception as e:
            raise BadRequest(f"Invalid request body: {e}")

        with Session(db.engine, expire_on_commit=False) as session:
            config = EvaluationService.save_evaluation_config(
                session=session,
                tenant_id=current_tenant_id,
                target_type="dataset",
                target_id=dataset_id_str,
                account_id=str(current_user.id),
                data=config_data,
            )

        return {
            "evaluation_model": config.evaluation_model,
            "evaluation_model_provider": config.evaluation_model_provider,
            "default_metrics": config.default_metrics_list,
            "customized_metrics": config.customized_metrics_dict,
            "judgment_config": config.judgment_config_dict,
        }


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/run")
class DatasetEvaluationRunApi(Resource):
    @console_ns.doc("start_dataset_evaluation_run")
    @console_ns.response(200, "Evaluation run started")
    @console_ns.response(400, "Invalid request")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, dataset_id):
        """Start an evaluation run for the knowledge base retrieval."""
        current_user, current_tenant_id = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        body = request.get_json(force=True)
        if not body:
            raise BadRequest("Request body is required.")

        try:
            run_request = EvaluationRunRequest.model_validate(body)
        except Exception as e:
            raise BadRequest(f"Invalid request body: {e}")

        upload_file = (
            db.session.query(UploadFile).filter_by(id=run_request.file_id, tenant_id=current_tenant_id).first()
        )
        if not upload_file:
            raise NotFound("Dataset file not found.")

        try:
            dataset_content = storage.load_once(upload_file.key)
        except Exception:
            raise BadRequest("Failed to read dataset file.")

        if not dataset_content:
            raise BadRequest("Dataset file is empty.")

        try:
            with Session(db.engine, expire_on_commit=False) as session:
                evaluation_run = EvaluationService.start_evaluation_run(
                    session=session,
                    tenant_id=current_tenant_id,
                    target_type=EvaluationTargetType.KNOWLEDGE_BASE,
                    target_id=dataset_id_str,
                    account_id=str(current_user.id),
                    dataset_file_content=dataset_content,
                    run_request=run_request,
                )
                return _serialize_dataset_evaluation_run(evaluation_run), 200
        except EvaluationFrameworkNotConfiguredError as e:
            return {"message": str(e.description)}, 400
        except EvaluationNotFoundError as e:
            return {"message": str(e.description)}, 404
        except EvaluationMaxConcurrentRunsError as e:
            return {"message": str(e.description)}, 429
        except EvaluationDatasetInvalidError as e:
            return {"message": str(e.description)}, 400


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/logs")
class DatasetEvaluationLogsApi(Resource):
    @console_ns.doc("get_dataset_evaluation_logs")
    @console_ns.response(200, "Evaluation logs retrieved")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        """Get evaluation run history for the knowledge base."""
        current_user, current_tenant_id = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        page = request.args.get("page", 1, type=int)
        page_size = request.args.get("page_size", 20, type=int)

        with Session(db.engine, expire_on_commit=False) as session:
            runs, total = EvaluationService.get_evaluation_runs(
                session=session,
                tenant_id=current_tenant_id,
                target_type="dataset",
                target_id=dataset_id_str,
                page=page,
                page_size=page_size,
            )

        return {
            "data": [_serialize_dataset_evaluation_run(run) for run in runs],
            "total": total,
            "page": page,
            "page_size": page_size,
        }


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/runs/<uuid:run_id>")
class DatasetEvaluationRunDetailApi(Resource):
    @console_ns.doc("get_dataset_evaluation_run_detail")
    @console_ns.response(200, "Evaluation run detail retrieved")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Dataset or run not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, run_id):
        """Get evaluation run detail including per-item results."""
        current_user, current_tenant_id = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        run_id_str = str(run_id)
        page = request.args.get("page", 1, type=int)
        page_size = request.args.get("page_size", 50, type=int)

        try:
            with Session(db.engine, expire_on_commit=False) as session:
                run = EvaluationService.get_evaluation_run_detail(
                    session=session,
                    tenant_id=current_tenant_id,
                    run_id=run_id_str,
                )
                items, total_items = EvaluationService.get_evaluation_run_items(
                    session=session,
                    run_id=run_id_str,
                    page=page,
                    page_size=page_size,
                )
                return {
                    "run": _serialize_dataset_evaluation_run(run),
                    "items": {
                        "data": [_serialize_dataset_evaluation_run_item(item) for item in items],
                        "total": total_items,
                        "page": page,
                        "page_size": page_size,
                    },
                }
        except EvaluationNotFoundError as e:
            return {"message": str(e.description)}, 404


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/runs/<uuid:run_id>/cancel")
class DatasetEvaluationRunCancelApi(Resource):
    @console_ns.doc("cancel_dataset_evaluation_run")
    @console_ns.response(200, "Evaluation run cancelled")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Dataset or run not found")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, dataset_id, run_id):
        """Cancel a running knowledge base evaluation."""
        current_user, current_tenant_id = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        run_id_str = str(run_id)
        try:
            with Session(db.engine, expire_on_commit=False) as session:
                run = EvaluationService.cancel_evaluation_run(
                    session=session,
                    tenant_id=current_tenant_id,
                    run_id=run_id_str,
                )
                return _serialize_dataset_evaluation_run(run)
        except EvaluationNotFoundError as e:
            return {"message": str(e.description)}, 404
        except ValueError as e:
            return {"message": str(e)}, 400


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/metrics")
class DatasetEvaluationMetricsApi(Resource):
    @console_ns.doc("get_dataset_evaluation_metrics")
    @console_ns.response(200, "Available retrieval metrics retrieved")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        """Get available evaluation metrics for knowledge base retrieval."""
        current_user, _ = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        return {
            "metrics": EvaluationService.get_supported_metrics(EvaluationCategory.RETRIEVAL)
        }


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/files/<uuid:file_id>")
class DatasetEvaluationFileDownloadApi(Resource):
    @console_ns.doc("download_dataset_evaluation_file")
    @console_ns.response(200, "File download URL generated")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Dataset or file not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, file_id):
        """Download evaluation test file or result file for the knowledge base."""
        from core.workflow.file import helpers as file_helpers

        current_user, current_tenant_id = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        file_id_str = str(file_id)
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(UploadFile).where(
                UploadFile.id == file_id_str,
                UploadFile.tenant_id == current_tenant_id,
            )
            upload_file = session.execute(stmt).scalar_one_or_none()

        if not upload_file:
            raise NotFound("File not found.")

        download_url = file_helpers.get_signed_file_url(upload_file_id=upload_file.id, as_attachment=True)

        return {
            "id": upload_file.id,
            "name": upload_file.name,
            "size": upload_file.size,
            "extension": upload_file.extension,
            "mime_type": upload_file.mime_type,
            "created_at": int(upload_file.created_at.timestamp()) if upload_file.created_at else None,
            "download_url": download_url,
        }
