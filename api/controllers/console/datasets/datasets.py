from datetime import datetime
from typing import Any
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from werkzeug.exceptions import Forbidden, NotFound

import services
from configs import dify_config
from controllers.common.fields import ApiBaseUrlResponse, SimpleResultResponse, UsageCheckResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.apikey import ApiKeyItem, ApiKeyList
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import DatasetInUseError, DatasetNameDuplicateError, IndexingEstimateError
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    enterprise_license_required,
    is_admin_or_owner_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.indexing_runner import IndexingRunner
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.rag.extractor.entity.extract_setting import ExtractSetting, NotionInfo, WebsiteInfo
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.dataset_fields import DatasetDetailResponse
from graphon.model_runtime.entities.model_entities import ModelType
from libs.helper import build_icon_url, dump_response, to_timestamp
from libs.login import login_required
from libs.url_utils import normalize_api_base_url
from models import Account, ApiToken, Dataset, Document, DocumentSegment, UploadFile
from models.dataset import DatasetPermission, DatasetPermissionEnum
from models.enums import ApiTokenType, SegmentStatus
from models.provider_ids import ModelProviderID
from services.api_token_service import ApiTokenCache
from services.dataset_service import DatasetPermissionService, DatasetService, DocumentService
from services.enterprise import rbac_service as enterprise_rbac_service

register_response_schema_models(console_ns, ApiBaseUrlResponse, SimpleResultResponse, UsageCheckResponse)

DATASET_LIST_PERMISSION_KEYS = frozenset({"dataset.preview", "dataset.acl.preview", "dataset.full_access"})


def _has_dataset_list_permission(permission_keys: list[str]) -> bool:
    return any(permission_key in DATASET_LIST_PERMISSION_KEYS for permission_key in permission_keys)


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
    retrieval_model: dict[str, Any] | None = Field(default=None)
    summary_index_setting: dict[str, Any] | None = Field(default=None)
    partial_member_list: list[dict[str, str]] | None = None
    external_retrieval_model: dict[str, Any] | None = Field(default=None)
    external_knowledge_id: str | None = None
    external_knowledge_api_id: str | None = None
    icon_info: dict[str, Any] | None = Field(default=None)
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


class DatasetListItemResponse(DatasetDetailResponse):
    partial_member_list: list[str]


class DatasetListResponse(ResponseModel):
    data: list[DatasetListItemResponse]
    has_more: bool
    limit: int
    total: int
    page: int


class DatasetDetailWithPartialMembersResponse(DatasetDetailResponse):
    partial_member_list: list[str] | None = None


class DatasetQueryFileInfoResponse(ResponseModel):
    id: str
    name: str
    size: int
    extension: str
    mime_type: str
    source_url: str


class DatasetQueryContentResponse(ResponseModel):
    content_type: str
    content: str
    file_info: DatasetQueryFileInfoResponse | None = None


class DatasetQueryDetailResponse(ResponseModel):
    id: str
    queries: list[DatasetQueryContentResponse]
    source: str
    source_app_id: str | None
    created_by_role: str
    created_by: str
    created_at: int

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class DatasetQueryListResponse(ResponseModel):
    data: list[DatasetQueryDetailResponse]
    has_more: bool
    limit: int
    total: int
    page: int


class RelatedAppResponse(ResponseModel):
    id: str
    name: str
    description: str
    mode: str = Field(validation_alias="mode_compatible_with_agent")
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    icon_url: str | None = None

    @model_validator(mode="after")
    def _set_icon_url(self) -> "RelatedAppResponse":
        self.icon_url = self.icon_url or build_icon_url(self.icon_type, self.icon)
        return self


class RelatedAppListResponse(ResponseModel):
    data: list[RelatedAppResponse]
    total: int


class DocumentStatusResponse(ResponseModel):
    id: str
    indexing_status: str
    processing_started_at: int | None
    parsing_completed_at: int | None
    cleaning_completed_at: int | None
    splitting_completed_at: int | None
    completed_at: int | None
    paused_at: int | None
    error: str | None
    stopped_at: int | None
    completed_segments: int | None = None
    total_segments: int | None = None

    @field_validator(
        "processing_started_at",
        "parsing_completed_at",
        "cleaning_completed_at",
        "splitting_completed_at",
        "completed_at",
        "paused_at",
        "stopped_at",
        mode="before",
    )
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class DocumentStatusListResponse(ResponseModel):
    data: list[DocumentStatusResponse]


class ErrorDocsResponse(DocumentStatusListResponse):
    total: int


class IndexingEstimatePreviewItemResponse(ResponseModel):
    content: str
    child_chunks: list[str] | None = None
    summary: str | None = None


class IndexingEstimateQaPreviewItemResponse(ResponseModel):
    question: str
    answer: str


class IndexingEstimateResponse(ResponseModel):
    total_segments: int
    preview: list[IndexingEstimatePreviewItemResponse]
    qa_preview: list[IndexingEstimateQaPreviewItemResponse] | None = None


class RetrievalSettingResponse(ResponseModel):
    retrieval_method: list[str]


class PartialMemberListResponse(ResponseModel):
    data: list[str]


class AutoDisableLogsResponse(ResponseModel):
    document_ids: list[str]
    count: int


register_schema_models(
    console_ns, DatasetCreatePayload, DatasetUpdatePayload, IndexingEstimatePayload, ConsoleDatasetListQuery
)
register_response_schema_models(
    console_ns,
    DatasetDetailResponse,
    DatasetDetailWithPartialMembersResponse,
    DatasetListResponse,
    DatasetQueryListResponse,
    IndexingEstimateResponse,
    RelatedAppListResponse,
    DocumentStatusListResponse,
    ErrorDocsResponse,
    RetrievalSettingResponse,
    PartialMemberListResponse,
    AutoDisableLogsResponse,
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
    @console_ns.doc(params=query_params_from_model(ConsoleDatasetListQuery))
    @console_ns.response(200, "Datasets retrieved successfully", console_ns.models[DatasetListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        # Convert query parameters to dict, handling list parameters correctly
        query_params: dict[str, str | list[str]] = dict(request.args.to_dict())
        # Handle ids and tag_ids as lists (Flask request.args.getlist returns list even for single value)
        if "ids" in request.args:
            query_params["ids"] = request.args.getlist("ids")
        if "tag_ids" in request.args:
            query_params["tag_ids"] = request.args.getlist("tag_ids")
        query = ConsoleDatasetListQuery.model_validate(query_params)

        permissions = enterprise_rbac_service.RBACService.MyPermissions.get(
            str(current_tenant_id),
            current_user.id,
        )

        accessible_dataset_ids: list[str] | None = None
        include_own_datasets = False
        if dify_config.RBAC_ENABLED:
            whitelist_scope = enterprise_rbac_service.RBACService.DatasetAccess.whitelist_resources(
                str(current_tenant_id),
                current_user.id,
            )
            has_default_readonly = _has_dataset_list_permission(
                permissions.dataset.default_permission_keys
            ) or _has_dataset_list_permission(permissions.workspace.permission_keys)
            permission_dataset_ids: set[str] | None = None
            if not has_default_readonly:
                permission_dataset_ids = {
                    override.resource_id
                    for override in permissions.dataset.overrides
                    if _has_dataset_list_permission(override.permission_keys)
                }
            if getattr(whitelist_scope, "unrestricted", False):
                filtered_dataset_ids = permission_dataset_ids
            else:
                filtered_dataset_ids = set(whitelist_scope.resource_ids)
                if permission_dataset_ids is not None:
                    filtered_dataset_ids |= permission_dataset_ids
                elif has_default_readonly:
                    filtered_dataset_ids = None
            if filtered_dataset_ids is not None:
                accessible_dataset_ids = sorted(filtered_dataset_ids)
            include_own_datasets = "dataset.create_and_management" in permissions.workspace.permission_keys

        if query.ids:
            datasets, total = DatasetService.get_datasets_by_ids(
                query.ids,
                current_tenant_id,
                user=current_user,
                accessible_dataset_ids=accessible_dataset_ids,
                include_own_datasets=include_own_datasets,
            )
        else:
            datasets, total = DatasetService.get_datasets(
                query.page,
                query.limit,
                db.session,
                current_tenant_id,
                current_user,
                query.keyword,
                query.tag_ids,
                query.include_all,
                accessible_dataset_ids=accessible_dataset_ids,
                include_own_datasets=include_own_datasets,
            )

        permission_keys_map = {}
        if datasets:
            dataset_ids = [str(dataset.id) for dataset in datasets]
            permission_keys_map = permissions.dataset.permission_keys_by_resource_ids(dataset_ids)

        # check embedding setting
        provider_manager = create_plugin_provider_manager(tenant_id=current_tenant_id)
        configurations = provider_manager.get_configurations(tenant_id=current_tenant_id)

        embedding_models = configurations.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        data = [dump_response(DatasetDetailResponse, dataset) for dataset in datasets]
        dataset_ids = [item["id"] for item in data if item.get("permission") == "partial_members"]
        partial_members_map: dict[str, list[str]] = {}
        if dataset_ids:
            partial_member_rows = db.session.execute(
                select(DatasetPermission.dataset_id, DatasetPermission.account_id).where(
                    DatasetPermission.dataset_id.in_(dataset_ids)
                )
            ).all()

            for dataset_id, account_id in partial_member_rows:
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
            item["permission_keys"] = permission_keys_map.get(str(item["id"]), [])

        response = {
            "data": data,
            "has_more": len(datasets) == query.limit,
            "limit": query.limit,
            "total": total,
            "page": query.page,
        }
        return dump_response(DatasetListResponse, response), 200

    @console_ns.doc("create_dataset")
    @console_ns.doc(description="Create a new dataset")
    @console_ns.expect(console_ns.models[DatasetCreatePayload.__name__])
    @console_ns.response(201, "Dataset created successfully", console_ns.models[DatasetDetailResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(
        RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT, resource_required=False
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        payload = DatasetCreatePayload.model_validate(console_ns.payload or {})

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        if dify_config.RBAC_ENABLED:
            permission = DatasetPermissionEnum.ALL_TEAM
        else:
            permission = payload.permission or DatasetPermissionEnum.ONLY_ME

        try:
            dataset = DatasetService.create_empty_dataset(
                tenant_id=current_tenant_id,
                name=payload.name,
                description=payload.description,
                indexing_technique=payload.indexing_technique,
                account=current_user,
                permission=permission,
                provider=payload.provider,
                external_knowledge_api_id=payload.external_knowledge_api_id,
                external_knowledge_id=payload.external_knowledge_id,
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        permission_keys_map = enterprise_rbac_service.RBACService.DatasetPermissions.batch_get(
            str(current_tenant_id),
            current_user.id,
            [str(dataset.id)],
        )

        item = DatasetDetailWithPartialMembersResponse.model_validate(dataset, from_attributes=True).model_dump(
            mode="json"
        )
        item["permission_keys"] = permission_keys_map.get(str(dataset.id), [])
        return item, 201


@console_ns.route("/datasets/<uuid:dataset_id>")
class DatasetApi(Resource):
    @console_ns.doc("get_dataset")
    @console_ns.doc(description="Get dataset details")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(
        200,
        "Dataset retrieved successfully",
        console_ns.models[DatasetDetailWithPartialMembersResponse.__name__],
    )
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user, db.session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        permissions = enterprise_rbac_service.RBACService.MyPermissions.get(
            str(current_tenant_id),
            current_user.id,
            dataset_id=dataset_id_str,
        )
        permission_keys_map = permissions.dataset.permission_keys_by_resource_ids([dataset_id_str])
        data = dump_response(DatasetDetailResponse, dataset)
        data["permission_keys"] = permission_keys_map.get(dataset_id_str, [])
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
    @console_ns.response(
        200,
        "Dataset updated successfully",
        console_ns.models[DatasetDetailWithPartialMembersResponse.__name__],
    )
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def patch(self, current_tenant_id: str, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        payload = DatasetUpdatePayload.model_validate(console_ns.payload or {})
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
        if not dify_config.RBAC_ENABLED:
            DatasetPermissionService.check_permission(
                current_user, dataset, payload.permission, payload.partial_member_list
            )

        dataset = DatasetService.update_dataset(dataset_id_str, payload_data, current_user)

        if dataset is None:
            raise NotFound("Dataset not found.")

        permission_keys_map = enterprise_rbac_service.RBACService.DatasetPermissions.batch_get(
            str(current_tenant_id),
            current_user.id,
            [dataset_id_str],
        )
        result_data = dump_response(DatasetDetailResponse, dataset)
        result_data["permission_keys"] = permission_keys_map.get(dataset_id_str, [])
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
    @console_ns.response(204, "Dataset deleted successfully")
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def delete(self, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)

        if not (current_user.has_edit_permission or current_user.is_dataset_operator):
            raise Forbidden()

        try:
            if DatasetService.delete_dataset(dataset_id_str, current_user):
                DatasetPermissionService.clear_partial_member_list(dataset_id_str)
                return "", 204
            else:
                raise NotFound("Dataset not found.")
        except services.errors.dataset.DatasetInUseError:
            raise DatasetInUseError()


@console_ns.route("/datasets/<uuid:dataset_id>/use-check")
class DatasetUseCheckApi(Resource):
    @console_ns.doc("check_dataset_use")
    @console_ns.doc(description="Check if dataset is in use")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(
        200,
        "Dataset use status retrieved successfully",
        console_ns.models[UsageCheckResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    def get(self, dataset_id: UUID):
        dataset_id_str = str(dataset_id)

        dataset_is_using = DatasetService.dataset_use_check(dataset_id_str)
        return {"is_using": dataset_is_using}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/queries")
class DatasetQueryApi(Resource):
    @console_ns.doc("get_dataset_queries")
    @console_ns.doc(description="Get dataset query history")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(
        200,
        "Query history retrieved successfully",
        console_ns.models[DatasetQueryListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    def get(self, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user, db.session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)

        dataset_queries, total = DatasetService.get_dataset_queries(dataset_id=dataset.id, page=page, per_page=limit)

        response = {
            "data": dataset_queries,
            "has_more": len(dataset_queries) == limit,
            "limit": limit,
            "total": total,
            "page": page,
        }
        return dump_response(DatasetQueryListResponse, response), 200


@console_ns.route("/datasets/indexing-estimate")
class DatasetIndexingEstimateApi(Resource):
    @console_ns.doc("estimate_dataset_indexing")
    @console_ns.doc(description="Estimate dataset indexing cost")
    @console_ns.response(
        200,
        "Indexing estimate calculated successfully",
        console_ns.models[IndexingEstimateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.expect(console_ns.models[IndexingEstimatePayload.__name__])
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        payload = IndexingEstimatePayload.model_validate(console_ns.payload or {})
        args = payload.model_dump()
        # validate args
        DocumentService.estimate_args_validate(args)
        extract_settings = []
        match args["info_list"]["data_source_type"]:
            case "upload_file":
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
            case "notion_import":
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
            case "website_crawl":
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
            case _:
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
    @console_ns.response(
        200,
        "Related apps retrieved successfully",
        console_ns.models[RelatedAppListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    def get(self, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user, db.session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        app_dataset_joins = DatasetService.get_related_apps(dataset.id)

        related_apps = []
        for app_dataset_join in app_dataset_joins:
            app_model = app_dataset_join.app
            if app_model:
                related_apps.append(app_model)

        return dump_response(RelatedAppListResponse, {"data": related_apps, "total": len(related_apps)}), 200


@console_ns.route("/datasets/<uuid:dataset_id>/indexing-status")
class DatasetIndexingStatusApi(Resource):
    @console_ns.doc("get_dataset_indexing_status")
    @console_ns.doc(description="Get dataset indexing status")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(
        200,
        "Indexing status retrieved successfully",
        console_ns.models[DocumentStatusListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    def get(self, current_tenant_id: str, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        documents = db.session.scalars(
            select(Document).where(Document.dataset_id == dataset_id_str, Document.tenant_id == current_tenant_id)
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
            documents_status.append(document_dict)
        return dump_response(DocumentStatusListResponse, {"data": documents_status}), 200


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
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        keys = db.session.scalars(
            select(ApiToken).where(ApiToken.type == self.resource_type, ApiToken.tenant_id == current_tenant_id)
        ).all()
        return ApiKeyList.model_validate({"data": keys}, from_attributes=True).model_dump(mode="json")

    @console_ns.response(200, "API key created successfully", console_ns.models[ApiKeyItem.__name__])
    @console_ns.response(400, "Maximum keys exceeded")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_API_KEY_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
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
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_API_KEY_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, api_key_id: UUID):
        api_key_id_str = str(api_key_id)
        key = db.session.scalar(
            select(ApiToken)
            .where(
                ApiToken.tenant_id == current_tenant_id,
                ApiToken.type == self.resource_type,
                ApiToken.id == api_key_id_str,
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

        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/api-keys/<string:status>")
class DatasetEnableApiApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def post(self, dataset_id: UUID, status: str):
        dataset_id_str = str(dataset_id)

        DatasetService.update_dataset_api_status(dataset_id_str, status == "enable")

        return {"result": "success"}, 200


@console_ns.route("/datasets/api-base-info")
class DatasetApiBaseUrlApi(Resource):
    @console_ns.doc("get_dataset_api_base_info")
    @console_ns.doc(description="Get dataset API base information")
    @console_ns.response(200, "API base info retrieved successfully", console_ns.models[ApiBaseUrlResponse.__name__])
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
    @console_ns.response(
        200, "Retrieval settings retrieved successfully", console_ns.models[RetrievalSettingResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        vector_type = dify_config.VECTOR_STORE
        return dump_response(
            RetrievalSettingResponse,
            _get_retrieval_methods_by_vector_type(vector_type, is_mock=False),
        )


@console_ns.route("/datasets/retrieval-setting/<string:vector_type>")
class DatasetRetrievalSettingMockApi(Resource):
    @console_ns.doc("get_dataset_retrieval_setting_mock")
    @console_ns.doc(description="Get mock dataset retrieval settings by vector type")
    @console_ns.doc(params={"vector_type": "Vector store type"})
    @console_ns.response(
        200,
        "Mock retrieval settings retrieved successfully",
        console_ns.models[RetrievalSettingResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, vector_type: str):
        return dump_response(
            RetrievalSettingResponse,
            _get_retrieval_methods_by_vector_type(vector_type, is_mock=True),
        )


@console_ns.route("/datasets/<uuid:dataset_id>/error-docs")
class DatasetErrorDocs(Resource):
    @console_ns.doc("get_dataset_error_docs")
    @console_ns.doc(description="Get dataset error documents")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(200, "Error documents retrieved successfully", console_ns.models[ErrorDocsResponse.__name__])
    @console_ns.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    def get(self, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        results = DocumentService.get_error_documents_by_dataset_id(dataset_id_str)

        return dump_response(ErrorDocsResponse, {"data": results, "total": len(results)}), 200


@console_ns.route("/datasets/<uuid:dataset_id>/permission-part-users")
class DatasetPermissionUserListApi(Resource):
    @console_ns.doc("get_dataset_permission_users")
    @console_ns.doc(description="Get dataset permission user list")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(
        200,
        "Permission users retrieved successfully",
        console_ns.models[PartialMemberListResponse.__name__],
    )
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    def get(self, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user, db.session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        partial_members_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str)

        return dump_response(PartialMemberListResponse, {"data": partial_members_list}), 200


@console_ns.route("/datasets/<uuid:dataset_id>/auto-disable-logs")
class DatasetAutoDisableLogApi(Resource):
    @console_ns.doc("get_dataset_auto_disable_logs")
    @console_ns.doc(description="Get dataset auto disable logs")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(
        200,
        "Auto disable logs retrieved successfully",
        console_ns.models[AutoDisableLogsResponse.__name__],
    )
    @console_ns.response(404, "Dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    def get(self, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        return dump_response(AutoDisableLogsResponse, DatasetService.get_dataset_auto_disable_logs(dataset_id_str)), 200
