from datetime import datetime
from typing import Any, Never
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter, field_validator, model_validator
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.common.fields import ApiBaseUrlResponse, SimpleResultResponse, UsageCheckResponse
from controllers.common.rbac import DatasetId, RBACCheck, Workspace, enforce_rbac_checks
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.apikey import ApiKeyItem, ApiKeyList
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import (
    DatasetAccessDeniedRequestError,
    DatasetInUseError,
    DatasetNameDuplicateError,
    IndexingEstimateError,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    cloud_edition_billing_rate_limit_check,
    model_validate,
)
from core.entities.knowledge_entities import IndexingEstimate
from core.rag.index_processor.constant.index_type import IndexStructureType
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.dataset_fields import (
    DatasetDetailResponse,
    NotionEstimateWorkspacePayload,
)
from libs.helper import build_icon_url, dump_response, to_timestamp
from machinery.context import RequestContext
from models.account import TenantAccountRole
from models.enums import PermissionEnum as DatasetPermissionEnum
from services.errors.dataset import DatasetInUseError as DatasetInUseFailure
from services.errors.dataset import DatasetNameDuplicateError as DatasetNameDuplicateFailure
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.datasets.application import DatasetKeyLimitError, DatasetKeyNotFoundError, DatasetListFilter
from services.knowledge.entities.indexing_estimate import (
    NewEstimateSource,
    NewSourcesEstimateCommand,
    NotionEstimateSource,
    UploadFileEstimateSource,
    WebsiteEstimateSource,
)
from services.knowledge.entities.knowledge_entities import FileInfo, WebsiteInfo
from services.knowledge.indexing.estimate import (
    EstimateSourceNotFoundError,
    IndexingEstimateCredentialUnavailableError,
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
    UnsupportedEstimateSourceError,
)

_DATASET_EDIT_ROLES = frozenset(
    {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR, TenantAccountRole.DATASET_OPERATOR}
)
_ADMIN_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})


def _raise_dataset_error(error: Exception) -> Never:
    if isinstance(error, DatasetNotFoundError):
        raise NotFound("Dataset not found.") from error
    if isinstance(error, DatasetAccessDeniedError):
        raise Forbidden(str(error)) from error
    if isinstance(error, DatasetNameDuplicateFailure):
        raise DatasetNameDuplicateError() from error
    if isinstance(error, DatasetInUseFailure):
        raise DatasetInUseError() from error
    raise error


register_response_schema_models(console_ns, ApiBaseUrlResponse, SimpleResultResponse, UsageCheckResponse)


def _validate_indexing_technique(value: str | None) -> str | None:
    if value is None:
        return value
    if value not in {"high_quality", "economy"}:
        raise ValueError("Invalid indexing technique.")
    return value


def _validate_doc_form(value: str | None) -> str | None:
    if value is None:
        return value
    if value not in {member.value for member in IndexStructureType}:
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
        if value not in {"vendor", "external"}:
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


_NOTION_SELECTIONS = TypeAdapter(list[NotionEstimateWorkspacePayload])


def _new_estimate_sources(info_list: dict[str, Any]) -> tuple[NewEstimateSource, ...]:
    match info_list.get("data_source_type"):
        case "upload_file":
            files = FileInfo.model_validate(info_list.get("file_info_list"))
            return tuple(UploadFileEstimateSource(file_id=file_id) for file_id in dict.fromkeys(files.file_ids))
        case "notion_import":
            workspaces = _NOTION_SELECTIONS.validate_python(info_list.get("notion_info_list"))
            return tuple(
                NotionEstimateSource(
                    workspace_id=workspace.workspace_id,
                    credential_id=workspace.credential_id,
                    page_id=page.page_id,
                    page_type=page.page_type,
                )
                for workspace in workspaces
                for page in workspace.pages
            )
        case "website_crawl":
            values = info_list.get("website_info_list")
            if not isinstance(values, dict):
                raise ValueError("Website info list is required")
            website = WebsiteInfo.model_validate({"only_main_content": False, **values})
            return tuple(
                WebsiteEstimateSource(
                    provider=website.provider,
                    job_id=website.job_id,
                    url=url,
                    only_main_content=website.only_main_content,
                )
                for url in website.urls
            )
        case _:
            raise ValueError("Data source type not support")


class DatasetApiKeyCreatePayload(BaseModel):
    # Knowledge bases to scope the key to. Absent/empty => the key can access every
    # dataset in the tenant (default). Declared so the generated client can send it.
    dataset_ids: list[str] = Field(default_factory=list)


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


class IndexingEstimateResponse(IndexingEstimate):
    tokens: int
    total_price: float | int
    currency: str


class RetrievalSettingResponse(ResponseModel):
    retrieval_method: list[str]


class PartialMemberListResponse(ResponseModel):
    data: list[str]


class AutoDisableLogsResponse(ResponseModel):
    document_ids: list[str]
    count: int


register_schema_models(
    console_ns,
    DatasetCreatePayload,
    DatasetUpdatePayload,
    IndexingEstimatePayload,
    ConsoleDatasetListQuery,
    DatasetApiKeyCreatePayload,
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


@console_ns.route("/datasets")
class DatasetListApi(Resource):
    @console_ns.doc("get_datasets")
    @console_ns.doc(description="Get list of datasets")
    @console_ns.doc(params=query_params_from_model(ConsoleDatasetListQuery))
    @console_ns.response(200, "Datasets retrieved successfully", console_ns.models[DatasetListResponse.__name__])
    @console_account_admission(require_valid_enterprise_license=True)
    def get(self, request_context: RequestContext):
        query_params: dict[str, str | list[str]] = dict(request.args.to_dict())
        for key in ("ids", "tag_ids"):
            if key in request.args:
                query_params[key] = request.args.getlist(key)
        query = ConsoleDatasetListQuery.model_validate(query_params)
        result = application_services().knowledge.datasets.list_datasets(
            request_context, DatasetListFilter(**query.model_dump())
        )
        return dump_response(DatasetListResponse, result), 200

    @console_ns.doc("create_dataset")
    @console_ns.doc(description="Create a new dataset")
    @console_ns.expect(console_ns.models[DatasetCreatePayload.__name__])
    @console_ns.response(
        201, "Dataset created successfully", console_ns.models[DatasetDetailWithPartialMembersResponse.__name__]
    )
    @console_ns.response(400, "Invalid request parameters")
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
        rbac_checks=(RBACCheck(RBACPermission.DATASET_CREATE_AND_MANAGEMENT, Workspace()),),
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    @model_validate(DatasetCreatePayload)
    def post(self, req_data: DatasetCreatePayload, request_context: RequestContext):
        try:
            result = application_services().knowledge.datasets.create_dataset(
                request_context, values=req_data.model_dump()
            )
        except Exception as error:
            _raise_dataset_error(error)
        return dump_response(DatasetDetailWithPartialMembersResponse, result), 201


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
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.datasets.get_dataset(request_context, dataset_id=str(dataset_id))
        except Exception as error:
            _raise_dataset_error(error)
        return dump_response(DatasetDetailWithPartialMembersResponse, result), 200

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
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    @model_validate(DatasetUpdatePayload)
    def patch(self, req_data: DatasetUpdatePayload, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.datasets.update_dataset(
                request_context, dataset_id=str(dataset_id), values=req_data.model_dump(exclude_unset=True)
            )
        except Exception as error:
            _raise_dataset_error(error)
        return dump_response(DatasetDetailWithPartialMembersResponse, result), 200

    @console_ns.response(204, "Dataset deleted successfully")
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    def delete(self, request_context: RequestContext, dataset_id: UUID):
        try:
            application_services().knowledge.datasets.delete_dataset(request_context, dataset_id=str(dataset_id))
        except Exception as error:
            _raise_dataset_error(error)
        return "", 204


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
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.datasets.is_in_use(request_context, dataset_id=str(dataset_id))
        except Exception as error:
            _raise_dataset_error(error)
        return dump_response(UsageCheckResponse, {"is_using": result}), 200


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
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.datasets.queries(
                request_context,
                dataset_id=str(dataset_id),
                page=request.args.get("page", default=1, type=int),
                limit=request.args.get("limit", default=20, type=int),
            )
        except Exception as error:
            _raise_dataset_error(error)
        return dump_response(DatasetQueryListResponse, result), 200


@console_ns.route("/datasets/indexing-estimate")
class DatasetIndexingEstimateApi(Resource):
    @console_ns.doc("estimate_dataset_indexing")
    @console_ns.doc(description="Estimate dataset indexing cost")
    @console_ns.response(
        200,
        "Indexing estimate calculated successfully",
        console_ns.models[IndexingEstimateResponse.__name__],
    )
    @console_ns.expect(console_ns.models[IndexingEstimatePayload.__name__])
    @console_account_admission()
    @model_validate(IndexingEstimatePayload)
    def post(self, req_data: IndexingEstimatePayload, request_context: RequestContext):
        if req_data.dataset_id:
            checks = [RBACCheck(RBACPermission.DATASET_USE, DatasetId())]
            path_args = {"dataset_id": req_data.dataset_id}
        else:
            checks = [RBACCheck(RBACPermission.DATASET_CREATE_AND_MANAGEMENT, Workspace())]
            path_args = None
        enforce_rbac_checks(
            tenant_id=request_context.active_workspace_id,
            account_id=request_context.account_id,
            checks=checks,
            path_args=path_args,
        )
        command = NewSourcesEstimateCommand(
            sources=_new_estimate_sources(req_data.info_list),
            process_rule=req_data.process_rule,
            doc_form=req_data.doc_form,
            doc_language=req_data.doc_language,
            dataset_id=req_data.dataset_id,
            indexing_technique=req_data.indexing_technique,
        )
        try:
            response = application_services().knowledge.indexing_estimates.estimate_new_sources(
                request_context,
                command,
            )
        except (
            IndexingEstimateCredentialUnavailableError,
            EstimateSourceNotFoundError,
            DatasetNotFoundError,
        ) as error:
            raise NotFoundError(description=str(error)) from error
        except DatasetAccessDeniedError as error:
            raise DatasetAccessDeniedRequestError(description=str(error)) from error
        except UnsupportedEstimateSourceError as error:
            raise InvalidArgumentError(description=str(error)) from error
        except IndexingEstimateProviderUnavailableError as error:
            raise ProviderNotInitializeError(str(error)) from error
        except IndexingEstimateExecutionError as error:
            raise IndexingEstimateError(str(error)) from error

        return (
            IndexingEstimateResponse(
                tokens=0,
                total_price=0,
                currency="USD",
                total_segments=response.total_segments,
                preview=response.preview,
                qa_preview=response.qa_preview,
            ).model_dump(mode="json", exclude_none=True),
            200,
        )


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
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.datasets.related_apps(request_context, dataset_id=str(dataset_id))
        except Exception as error:
            _raise_dataset_error(error)
        return dump_response(RelatedAppListResponse, result), 200


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
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.datasets.indexing_status(
                request_context, dataset_id=str(dataset_id)
            )
        except Exception as error:
            _raise_dataset_error(error)
        return dump_response(DocumentStatusListResponse, result), 200


@console_ns.route("/datasets/api-keys")
class DatasetApiKeyApi(Resource):
    @console_ns.doc("get_dataset_api_keys")
    @console_ns.doc(description="Get dataset API keys")
    @console_ns.response(200, "API keys retrieved successfully", console_ns.models[ApiKeyList.__name__])
    @console_account_admission(
        allowed_roles=_ADMIN_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_API_KEY_MANAGE, Workspace()),)
    )
    def get(self, request_context: RequestContext):
        result = application_services().knowledge.datasets.list_keys(request_context)
        return dump_response(ApiKeyList, {"data": result})

    @console_ns.expect(console_ns.models[DatasetApiKeyCreatePayload.__name__])
    @console_ns.response(200, "API key created successfully", console_ns.models[ApiKeyItem.__name__])
    @console_ns.response(400, "Maximum keys exceeded")
    @console_account_admission(
        allowed_roles=_ADMIN_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_API_KEY_MANAGE, Workspace()),)
    )
    def post(self, request_context: RequestContext):
        payload = request.get_json(silent=True) or {}
        dataset_ids = payload.get("dataset_ids") or []
        if not isinstance(dataset_ids, list) or any(not isinstance(item, str) for item in dataset_ids):
            console_ns.abort(400, message="dataset_ids must be a list of strings.")
        try:
            result = application_services().knowledge.datasets.create_key(request_context, dataset_ids=dataset_ids)
        except DatasetKeyLimitError as error:
            console_ns.abort(400, message=str(error), custom="max_keys_exceeded")
        except ValueError as error:
            console_ns.abort(400, message=str(error))
        return dump_response(ApiKeyItem, result), 200


@console_ns.route("/datasets/api-keys/<uuid:api_key_id>")
class DatasetApiDeleteApi(Resource):
    @console_ns.doc("delete_dataset_api_key")
    @console_ns.doc(description="Delete dataset API key")
    @console_ns.doc(params={"api_key_id": "API key ID"})
    @console_ns.response(204, "API key deleted successfully")
    @console_account_admission(
        allowed_roles=_ADMIN_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_API_KEY_MANAGE, Workspace()),)
    )
    def delete(self, request_context: RequestContext, api_key_id: UUID):
        try:
            application_services().knowledge.datasets.delete_key(request_context, key_id=str(api_key_id))
        except DatasetKeyNotFoundError as error:
            console_ns.abort(404, message=str(error))
        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/api-keys/<string:status>")
class DatasetEnableApiApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    def post(self, request_context: RequestContext, dataset_id: UUID, status: str):
        try:
            application_services().knowledge.datasets.set_api_enabled(
                request_context, dataset_id=str(dataset_id), status=status
            )
        except Exception as error:
            _raise_dataset_error(error)
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/datasets/api-base-info")
class DatasetApiBaseUrlApi(Resource):
    @console_ns.doc("get_dataset_api_base_info")
    @console_ns.doc(description="Get dataset API base information")
    @console_ns.response(200, "API base info retrieved successfully", console_ns.models[ApiBaseUrlResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        base = application_services().knowledge.datasets.api_base_url(
            request_context, request_base_url=request.host_url.rstrip("/")
        )
        return ApiBaseUrlResponse(api_base_url=base).model_dump(mode="json")


@console_ns.route("/datasets/retrieval-setting")
class DatasetRetrievalSettingApi(Resource):
    @console_ns.doc("get_dataset_retrieval_setting")
    @console_ns.doc(description="Get dataset retrieval settings")
    @console_ns.response(
        200, "Retrieval settings retrieved successfully", console_ns.models[RetrievalSettingResponse.__name__]
    )
    @console_account_admission()
    def get(self, request_context: RequestContext):
        result = application_services().knowledge.datasets.retrieval_settings(request_context)
        return dump_response(RetrievalSettingResponse, result)


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
    @console_account_admission()
    def get(self, request_context: RequestContext, vector_type: str):
        result = application_services().knowledge.datasets.retrieval_settings(
            request_context, vector_type=vector_type, is_mock=True
        )
        return dump_response(RetrievalSettingResponse, result)


@console_ns.route("/datasets/<uuid:dataset_id>/error-docs")
class DatasetErrorDocs(Resource):
    @console_ns.doc("get_dataset_error_docs")
    @console_ns.doc(description="Get dataset error documents")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.response(200, "Error documents retrieved successfully", console_ns.models[ErrorDocsResponse.__name__])
    @console_ns.response(404, "Dataset not found")
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.datasets.error_documents(
                request_context, dataset_id=str(dataset_id)
            )
        except Exception as error:
            _raise_dataset_error(error)
        return dump_response(ErrorDocsResponse, result), 200


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
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.datasets.partial_members(
                request_context, dataset_id=str(dataset_id)
            )
        except Exception as error:
            _raise_dataset_error(error)
        return dump_response(PartialMemberListResponse, {"data": result}), 200


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
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.datasets.auto_disable_logs(
                request_context, dataset_id=str(dataset_id)
            )
        except Exception as error:
            _raise_dataset_error(error)
        return dump_response(AutoDisableLogsResponse, result), 200
