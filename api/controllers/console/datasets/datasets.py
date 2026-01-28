from typing import Any, cast

from flask import request
from flask_restx import Resource, fields, marshal, marshal_with
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from werkzeug.exceptions import Forbidden, NotFound

import services
from configs import dify_config
from controllers.common.schema import get_or_create_model, register_schema_models
from controllers.console import console_ns
from controllers.console.apikey import (
    api_key_item_model,
    api_key_list_model,
)
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
from core.indexing_runner import IndexingRunner
from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.rag.extractor.entity.extract_setting import ExtractSetting, NotionInfo, WebsiteInfo
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
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
from models import ApiToken, Dataset, Document, DocumentSegment, UploadFile
from models.dataset import DatasetPermissionEnum
from models.provider_ids import ModelProviderID
from services.dataset_service import DatasetPermissionService, DatasetService, DocumentService

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
        query = ConsoleDatasetListQuery.model_validate(request.args.to_dict())
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
            payload.indexing_technique == "high_quality"
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

    @console_ns.doc("get_dataset_api_keys")
    @console_ns.doc(description="Get dataset API keys")
    @console_ns.response(200, "API keys retrieved successfully", api_key_list_model)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_key_list_model)
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        keys = db.session.scalars(
            select(ApiToken).where(ApiToken.type == self.resource_type, ApiToken.tenant_id == current_tenant_id)
        ).all()
        return {"items": keys}

    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    @marshal_with(api_key_item_model)
    def post(self):
        _, current_tenant_id = current_account_with_tenant()

        current_key_count = (
            db.session.query(ApiToken)
            .where(ApiToken.type == self.resource_type, ApiToken.tenant_id == current_tenant_id)
            .count()
        )

        if current_key_count >= self.max_keys:
            console_ns.abort(
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
            console_ns.abort(404, message="API key not found")

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
    @console_ns.doc("get_dataset_api_base_info")
    @console_ns.doc(description="Get dataset API base information")
    @console_ns.response(200, "API base info retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        return {"api_base_url": (dify_config.SERVICE_API_URL or request.host_url.rstrip("/")) + "/v1"}


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
