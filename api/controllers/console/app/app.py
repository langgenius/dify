import logging
import uuid
from collections.abc import Iterator, Sequence
from datetime import datetime
from typing import Any, Literal

from flask import request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, computed_field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound

from configs import dify_config
from controllers.common.app_access import resolve_app_access_filter
from controllers.common.fields import RedirectUrlResponse, SimpleResultResponse
from controllers.common.helpers import FileInfo
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_enum_models,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model, with_session
from controllers.console.workspace.models import LoadBalancingPayload
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    cloud_edition_billing_resource_check,
    edit_permission_required,
    enterprise_license_required,
    is_admin_or_owner_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
    with_current_user_id,
)
from core.ops.ops_trace_manager import OpsTraceManager
from core.rbac import RBACResourceWhitelistScope
from core.rag.entities import PreProcessingRule, Rule, Segmentation
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.trigger.constants import TRIGGER_NODE_TYPES
from extensions.ext_database import db
from fields.base import ResponseModel
from graphon.enums import WorkflowExecutionStatus
from libs.helper import build_icon_url, dump_response, to_timestamp
from libs.login import login_required
from models import Account, App, DatasetPermissionEnum, TenantAccountJoin, Workflow
from models.model import IconType
from services.app_dsl_service import AppDslService
from services.app_service import AppListParams, AppListSortBy, AppService, CreateAppParams, StarredAppListParams
from services.enterprise import rbac_service as enterprise_rbac_service
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.dsl_entities import ImportMode, ImportStatus
from services.entities.knowledge_entities.knowledge_entities import (
    DataSource,
    InfoList,
    NotionIcon,
    NotionInfo,
    NotionPage,
    RerankingModel,
    WebsiteInfo,
    WeightKeywordSetting,
    WeightModel,
    WeightVectorSetting,
)
from services.feature_service import FeatureService

ALLOW_CREATE_APP_MODES = ["chat", "agent-chat", "advanced-chat", "workflow", "completion"]

register_enum_models(console_ns, IconType)

_logger = logging.getLogger(__name__)
AppListMode = Literal["completion", "chat", "advanced-chat", "workflow", "agent-chat", "agent", "channel", "all"]
DEFAULT_APP_LIST_MODE: AppListMode = "all"
APP_LIST_QUERY_ARRAY_FIELDS = ("tag_ids", "creator_ids")
APP_RBAC_ACCOUNT_POLICY_BATCH_SIZE = 500
APP_RBAC_DEFAULT_ACCESS_POLICY_ID = "default"


def _iter_tenant_member_account_id_batches(tenant_id: str, batch_size: int) -> Iterator[list[str]]:
    """Yield workspace member account ids in bounded batches for RBAC bulk writes."""
    offset = 0
    while True:
        stmt = (
            select(TenantAccountJoin.account_id)
            .where(TenantAccountJoin.tenant_id == tenant_id)
            .order_by(TenantAccountJoin.id)
            .offset(offset)
            .limit(batch_size)
        )

        account_ids = list(db.session.scalars(stmt).all())
        if not account_ids:
            break

        yield account_ids
        offset += batch_size


def _initialize_created_app_rbac_access(tenant_id: str, account_id: str, app_id: str) -> None:
    """Initialize a newly created app's RBAC access for all current workspace members."""
    if not dify_config.RBAC_ENABLED:
        return

    enterprise_rbac_service.RBACService.AppAccess.replace_whitelist(
        tenant_id=tenant_id,
        account_id=account_id,
        app_id=app_id,
        payload=enterprise_rbac_service.ReplaceMemberBindings(scope=RBACResourceWhitelistScope.ALL),
    )

    for account_ids in _iter_tenant_member_account_id_batches(tenant_id, APP_RBAC_ACCOUNT_POLICY_BATCH_SIZE):
        enterprise_rbac_service.RBACService.AppAccess.replace_user_access_policies(
            tenant_id=tenant_id,
            account_id=account_id,
            app_id=app_id,
            payload=enterprise_rbac_service.ReplaceUserAccessPolicies(
                access_policy_ids=[APP_RBAC_DEFAULT_ACCESS_POLICY_ID],
                account_ids=account_ids,
            ),
        )


class AppListBaseQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999, description="Page number (1-99999)")
    limit: int = Field(default=20, ge=1, le=100, description="Page size (1-100)")
    mode: AppListMode = Field(default=DEFAULT_APP_LIST_MODE, description="App mode filter")
    sort_by: AppListSortBy = Field(
        default="last_modified",
        description="Sort apps by last modified, recently created, or earliest created",
    )
    name: str | None = Field(default=None, description="Filter by app name")
    tag_ids: list[str] | None = Field(default=None, description="Filter by tag IDs")
    creator_ids: list[str] | None = Field(default=None, description="Filter by creator account IDs")
    is_created_by_me: bool | None = Field(default=None, description="Filter by creator")

    @field_validator("tag_ids", mode="before")
    @classmethod
    def validate_tag_ids(cls, value: list[str] | None) -> list[str] | None:
        if not value:
            return None

        if not isinstance(value, list):
            raise ValueError("Unsupported tag_ids type.")

        items = [str(item).strip() for item in value if item and str(item).strip()]
        if not items:
            return None

        try:
            return [str(uuid.UUID(item)) for item in items]
        except ValueError as exc:
            raise ValueError("Invalid UUID format in tag_ids.") from exc

    @field_validator("creator_ids", mode="before")
    @classmethod
    def validate_creator_ids(cls, value: list[str] | None) -> list[str] | None:
        if not value:
            return None

        if not isinstance(value, list):
            raise ValueError("Unsupported creator_ids type.")

        items = [str(item).strip() for item in value if item and str(item).strip()]
        if not items:
            return None

        try:
            return [str(uuid.UUID(item)) for item in items]
        except ValueError as exc:
            raise ValueError("Invalid UUID format in creator_ids.") from exc


class AppListQuery(AppListBaseQuery):
    pass


class StarredAppListQuery(AppListBaseQuery):
    pass


class CreateAppPayload(BaseModel):
    name: str = Field(..., min_length=1, description="App name")
    description: str | None = Field(default=None, description="App description (max 400 chars)", max_length=400)
    mode: Literal["chat", "agent-chat", "advanced-chat", "workflow", "completion"] = Field(..., description="App mode")
    icon_type: IconType | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")


class UpdateAppPayload(BaseModel):
    name: str = Field(..., min_length=1, description="App name")
    description: str | None = Field(default=None, description="App description (max 400 chars)", max_length=400)
    icon_type: IconType | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")
    use_icon_as_answer_icon: bool | None = Field(default=None, description="Use icon as answer icon")
    max_active_requests: int | None = Field(default=None, description="Maximum active requests")


class CopyAppPayload(BaseModel):
    name: str | None = Field(default=None, description="Name for the copied app")
    description: str | None = Field(default=None, description="Description for the copied app", max_length=400)
    icon_type: IconType | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")


class AppExportQuery(BaseModel):
    include_secret: bool = Field(default=False, description="Include secrets in export")
    workflow_id: str | None = Field(default=None, description="Specific workflow ID to export")


class AppNamePayload(BaseModel):
    name: str = Field(..., min_length=1, description="Name to check")


class AppIconPayload(BaseModel):
    icon: str | None = Field(default=None, description="Icon data")
    icon_type: IconType | None = Field(default=None, description="Icon type")
    icon_background: str | None = Field(default=None, description="Icon background color")


class AppSiteStatusPayload(BaseModel):
    enable_site: bool = Field(..., description="Enable or disable site")


class AppApiStatusPayload(BaseModel):
    enable_api: bool = Field(..., description="Enable or disable API")


class AppTracePayload(BaseModel):
    enabled: bool = Field(..., description="Enable or disable tracing")
    tracing_provider: str | None = Field(default=None, description="Tracing provider")

    @field_validator("tracing_provider")
    @classmethod
    def validate_tracing_provider(cls, value: str | None, info) -> str | None:
        if info.data.get("enabled") and not value:
            raise ValueError("tracing_provider is required when enabled is True")
        return value


class AppTraceResponse(ResponseModel):
    enabled: bool = False
    tracing_provider: str | None = None


class Tag(ResponseModel):
    id: str
    name: str
    type: str


class WorkflowPartial(ResponseModel):
    id: str
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class ModelConfigPartial(ResponseModel):
    model: Any | None = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    pre_prompt: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class ModelConfig(ResponseModel):
    opening_statement: str | None = None
    suggested_questions: Any | None = Field(
        default=None, validation_alias=AliasChoices("suggested_questions_list", "suggested_questions")
    )
    suggested_questions_after_answer: Any | None = Field(
        default=None,
        validation_alias=AliasChoices("suggested_questions_after_answer_dict", "suggested_questions_after_answer"),
    )
    speech_to_text: Any | None = Field(
        default=None, validation_alias=AliasChoices("speech_to_text_dict", "speech_to_text")
    )
    text_to_speech: Any | None = Field(
        default=None, validation_alias=AliasChoices("text_to_speech_dict", "text_to_speech")
    )
    retriever_resource: Any | None = Field(
        default=None, validation_alias=AliasChoices("retriever_resource_dict", "retriever_resource")
    )
    annotation_reply: Any | None = Field(
        default=None, validation_alias=AliasChoices("annotation_reply_dict", "annotation_reply")
    )
    more_like_this: Any | None = Field(
        default=None, validation_alias=AliasChoices("more_like_this_dict", "more_like_this")
    )
    sensitive_word_avoidance: Any | None = Field(
        default=None, validation_alias=AliasChoices("sensitive_word_avoidance_dict", "sensitive_word_avoidance")
    )
    external_data_tools: Any | None = Field(
        default=None, validation_alias=AliasChoices("external_data_tools_list", "external_data_tools")
    )
    model: Any | None = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    user_input_form: Any | None = Field(
        default=None, validation_alias=AliasChoices("user_input_form_list", "user_input_form")
    )
    dataset_query_variable: str | None = None
    pre_prompt: str | None = None
    agent_mode: Any | None = Field(default=None, validation_alias=AliasChoices("agent_mode_dict", "agent_mode"))
    prompt_type: str | None = None
    chat_prompt_config: Any | None = Field(
        default=None, validation_alias=AliasChoices("chat_prompt_config_dict", "chat_prompt_config")
    )
    completion_prompt_config: Any | None = Field(
        default=None, validation_alias=AliasChoices("completion_prompt_config_dict", "completion_prompt_config")
    )
    dataset_configs: Any | None = Field(
        default=None, validation_alias=AliasChoices("dataset_configs_dict", "dataset_configs")
    )
    file_upload: Any | None = Field(default=None, validation_alias=AliasChoices("file_upload_dict", "file_upload"))
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AppDetailSiteResponse(ResponseModel):
    access_token: str | None = Field(default=None, validation_alias="code")
    code: str | None = None
    title: str | None = None
    icon_type: str | IconType | None = None
    icon: str | None = None
    icon_background: str | None = None
    description: str | None = None
    default_language: str | None = None
    chat_color_theme: str | None = None
    chat_color_theme_inverted: bool | None = None
    customize_domain: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    input_placeholder: str | None = None
    custom_disclaimer: str | None = None
    customize_token_strategy: str | None = None
    prompt_public: bool | None = None
    app_base_url: str | None = None
    show_workflow_steps: bool | None = None
    use_icon_as_answer_icon: bool | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @computed_field(return_type=str | None)  # type: ignore
    @property
    def icon_url(self) -> str | None:
        return build_icon_url(self.icon_type, self.icon)

    @field_validator("icon_type", mode="before")
    @classmethod
    def _normalize_icon_type(cls, value: str | IconType | None) -> str | None:
        if isinstance(value, IconType):
            return value.value
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class DeletedTool(ResponseModel):
    type: str
    tool_name: str
    provider_id: str


class AppPartial(ResponseModel):
    id: str
    name: str
    max_active_requests: int | None = None
    description: str | None = Field(default=None, validation_alias=AliasChoices("desc_or_prompt", "description"))
    mode: str = Field(validation_alias="mode_compatible_with_agent")
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    model_config_: ModelConfigPartial | None = Field(
        default=None,
        validation_alias=AliasChoices("app_model_config", "model_config"),
        alias="model_config",
    )
    workflow: WorkflowPartial | None = None
    use_icon_as_answer_icon: bool | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None
    tags: list[Tag] = Field(default_factory=list)
    access_mode: str | None = None
    create_user_name: str | None = None
    author_name: str | None = None
    has_draft_trigger: bool | None = None
    permission_keys: list[str] = Field(default_factory=list)
    # For Agent App type: the roster Agent backing this app (None otherwise).
    bound_agent_id: str | None = None
    # For Agent App responses exposed through /agent.
    app_id: str | None = None
    is_starred: bool = False
    maintainer: str | None = None

    @computed_field(return_type=str | None)  # type: ignore
    @property
    def icon_url(self) -> str | None:
        return build_icon_url(self.icon_type, self.icon)

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AppDetail(ResponseModel):
    id: str
    name: str
    description: str | None = None
    mode: str = Field(validation_alias="mode_compatible_with_agent")
    icon: str | None = None
    icon_background: str | None = None
    enable_site: bool
    enable_api: bool
    model_config_: ModelConfig | None = Field(
        default=None,
        validation_alias=AliasChoices("app_model_config", "model_config"),
        alias="model_config",
    )
    workflow: WorkflowPartial | None = None
    tracing: Any | None = None
    use_icon_as_answer_icon: bool | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None
    access_mode: str | None = None
    tags: list[Tag] = Field(default_factory=list)
    permission_keys: list[str] = Field(default_factory=list)
    maintainer: str | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AppDetailWithSite(AppDetail):
    icon_type: str | None = None
    api_base_url: str | None = None
    max_active_requests: int | None = None
    deleted_tools: list[DeletedTool] = Field(default_factory=list)
    site: AppDetailSiteResponse | None = None
    # For Agent App type: the roster Agent backing this app (None otherwise).
    bound_agent_id: str | None = None
    # For Agent App responses exposed through /agent.
    app_id: str | None = None

    @computed_field(return_type=str | None)  # type: ignore
    @property
    def icon_url(self) -> str | None:
        return build_icon_url(self.icon_type, self.icon)


class AppPagination(ResponseModel):
    page: int
    limit: int = Field(validation_alias=AliasChoices("per_page", "limit"))
    total: int
    has_more: bool = Field(validation_alias=AliasChoices("has_next", "has_more"))
    data: list[AppPartial] = Field(validation_alias=AliasChoices("items", "data"))


class AppExportResponse(ResponseModel):
    data: str


class AppImportResponse(ResponseModel):
    id: str
    status: ImportStatus
    app_id: str | None = None
    app_mode: str | None = None
    current_dsl_version: str
    imported_dsl_version: str = ""
    error: str = ""


def _enrich_app_list_items(session: Session, *, apps: Sequence[App], tenant_id: str) -> None:
    if FeatureService.get_system_features().webapp_auth.enabled:
        app_ids = [str(app.id) for app in apps]
        res = EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id(app_ids=app_ids)
        if len(res) != len(app_ids):
            raise BadRequest("Invalid app id in webapp auth")

        for app in apps:
            if str(app.id) in res:
                app.access_mode = res[str(app.id)].access_mode

    workflow_capable_app_ids = [str(app.id) for app in apps if app.mode in {"workflow", "advanced-chat"}]
    draft_trigger_app_ids: set[str] = set()
    if workflow_capable_app_ids:
        draft_workflows = (
            session.execute(
                select(Workflow).where(
                    Workflow.version == Workflow.VERSION_DRAFT,
                    Workflow.app_id.in_(workflow_capable_app_ids),
                    Workflow.tenant_id == tenant_id,
                )
            )
            .scalars()
            .all()
        )
        trigger_node_types = TRIGGER_NODE_TYPES
        for workflow in draft_workflows:
            node_id = None
            try:
                for node_id, node_data in workflow.walk_nodes():
                    if node_data.get("type") in trigger_node_types:
                        draft_trigger_app_ids.add(str(workflow.app_id))
                        break
            except Exception:
                _logger.exception("error while walking nodes, workflow_id=%s, node_id=%s", workflow.id, node_id)
                continue

    for app in apps:
        app.has_draft_trigger = str(app.id) in draft_trigger_app_ids


register_enum_models(console_ns, RetrievalMethod, WorkflowExecutionStatus, DatasetPermissionEnum)
register_response_schema_models(
    console_ns, RedirectUrlResponse, SimpleResultResponse, AppImportResponse, AppTraceResponse
)

register_schema_models(
    console_ns,
    AppListQuery,
    StarredAppListQuery,
    CreateAppPayload,
    UpdateAppPayload,
    CopyAppPayload,
    AppExportQuery,
    AppNamePayload,
    AppIconPayload,
    AppSiteStatusPayload,
    AppApiStatusPayload,
    AppTracePayload,
    Tag,
    WorkflowPartial,
    ModelConfigPartial,
    ModelConfig,
    AppDetailSiteResponse,
    DeletedTool,
    AppDetail,
    AppExportResponse,
    Segmentation,
    PreProcessingRule,
    Rule,
    WeightVectorSetting,
    WeightKeywordSetting,
    WeightModel,
    RerankingModel,
    InfoList,
    NotionInfo,
    FileInfo,
    WebsiteInfo,
    NotionPage,
    NotionIcon,
    RerankingModel,
    DataSource,
    LoadBalancingPayload,
)

register_response_schema_models(
    console_ns,
    AppPartial,
    AppDetailWithSite,
    AppPagination,
)


@console_ns.route("/apps")
class AppListApi(Resource):
    @console_ns.doc("list_apps")
    @console_ns.doc(description="Get list of applications with pagination and filtering")
    @console_ns.doc(params=query_params_from_model(AppListQuery))
    @console_ns.response(200, "Success", console_ns.models[AppPagination.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_session(write=False)
    @with_current_user_id
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user_id: str, session: Session):
        """Get app list"""
        args = query_params_from_request(AppListQuery, list_fields=APP_LIST_QUERY_ARRAY_FIELDS)
        params = AppListParams(
            page=args.page,
            limit=args.limit,
            mode=args.mode,
            sort_by=args.sort_by,
            name=args.name,
            tag_ids=args.tag_ids,
            creator_ids=args.creator_ids,
            is_created_by_me=args.is_created_by_me,
        )

        permissions = enterprise_rbac_service.RBACService.MyPermissions.get(
            str(current_tenant_id),
            current_user_id,
            session=db.session(),
        )
        if dify_config.RBAC_ENABLED:
            access_filter = resolve_app_access_filter(
                str(current_tenant_id),
                current_user_id,
                permissions=permissions,
            )
            access_filter.apply_to_params(params)

        # get app list
        app_service = AppService()
        app_pagination = app_service.get_paginate_apps(current_user_id, current_tenant_id, params, session)
        if not app_pagination:
            response = AppPagination(page=args.page, limit=args.limit, total=0, has_more=False, data=[])
            return response.model_dump(mode="json"), 200

        app_ids = [str(app.id) for app in app_pagination.items]
        permission_keys_map = permissions.app.permission_keys_by_resource_ids(app_ids)
        _enrich_app_list_items(session, apps=app_pagination.items, tenant_id=current_tenant_id)

        pagination_model = AppPagination.model_validate(app_pagination, from_attributes=True)
        if app_pagination.items:
            pagination_model = pagination_model.model_copy(
                update={
                    "data": [
                        item.model_copy(update={"permission_keys": permission_keys_map.get(str(item.id), [])})
                        for item in pagination_model.data
                    ]
                }
            )
        return pagination_model.model_dump(mode="json"), 200

    @console_ns.doc("create_app")
    @console_ns.doc(description="Create a new application")
    @console_ns.expect(console_ns.models[CreateAppPayload.__name__])
    @console_ns.response(201, "App created successfully", console_ns.models[AppDetailWithSite.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_CREATE_AND_MANAGEMENT, resource_required=False)
    @cloud_edition_billing_resource_check("apps")
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        """Create app"""
        args = CreateAppPayload.model_validate(console_ns.payload)
        params = CreateAppParams(
            name=args.name,
            description=args.description,
            mode=args.mode,
            icon_type=args.icon_type,
            icon=args.icon,
            icon_background=args.icon_background,
        )

        app_service = AppService()
        app = app_service.create_app(current_tenant_id, params, current_user, session=db.session())
        _initialize_created_app_rbac_access(str(current_tenant_id), current_user.id, str(app.id))
        permission_keys_map = enterprise_rbac_service.RBACService.AppPermissions.batch_get(
            str(current_tenant_id),
            current_user.id,
            [str(app.id)],
            session=db.session(),
        )
        app_detail = AppDetailWithSite.model_validate(app, from_attributes=True).model_copy(
            update={"permission_keys": permission_keys_map.get(str(app.id), [])}
        )
        return app_detail.model_dump(mode="json"), 201


@console_ns.route("/apps/starred")
class StarredAppListApi(Resource):
    @console_ns.doc("list_starred_apps")
    @console_ns.doc(description="Get applications starred by the current account")
    @console_ns.doc(params=query_params_from_model(StarredAppListQuery))
    @console_ns.response(200, "Success", console_ns.models[AppPagination.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_session(write=False)
    @with_current_user_id
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user_id: str, session: Session):
        args = query_params_from_request(StarredAppListQuery, list_fields=APP_LIST_QUERY_ARRAY_FIELDS)
        params = StarredAppListParams(
            page=args.page,
            limit=args.limit,
            mode=args.mode,
            sort_by=args.sort_by,
            name=args.name,
            tag_ids=args.tag_ids,
            creator_ids=args.creator_ids,
            is_created_by_me=args.is_created_by_me,
        )

        app_pagination = AppService().get_paginate_starred_apps(current_user_id, current_tenant_id, params, session)
        if not app_pagination:
            empty = AppPagination(page=args.page, limit=args.limit, total=0, has_more=False, data=[])
            return empty.model_dump(mode="json"), 200

        _enrich_app_list_items(session, apps=app_pagination.items, tenant_id=current_tenant_id)
        return AppPagination.model_validate(app_pagination, from_attributes=True).model_dump(mode="json"), 200


@console_ns.route("/apps/<uuid:app_id>/star")
class AppStarApi(Resource):
    @console_ns.doc("star_app")
    @console_ns.doc(description="Star an application for the current account")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(404, "App not found")
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_current_user_id
    @with_session
    @get_app_model(mode=None)
    def post(self, session: Session, current_user_id: str, app_model: App):
        AppService.star_app(app=app_model, account_id=current_user_id, session=session)
        return SimpleResultResponse(result="success").model_dump(mode="json")

    @console_ns.doc("unstar_app")
    @console_ns.doc(description="Remove the current account's star from an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(404, "App not found")
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_current_user_id
    @with_session
    @get_app_model(mode=None)
    def delete(self, session: Session, current_user_id: str, app_model: App):
        AppService.unstar_app(app=app_model, account_id=current_user_id, session=session)
        return SimpleResultResponse(result="success").model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>")
class AppApi(Resource):
    @console_ns.doc("get_app_detail")
    @console_ns.doc(description="Get application details")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Success", console_ns.models[AppDetailWithSite.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=None)
    def get(self, current_tenant_id: str, current_user: Account, app_model: App):
        """Get app detail"""
        app_service = AppService()

        app_model = app_service.get_app(app_model)

        if FeatureService.get_system_features().webapp_auth.enabled:
            app_setting = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=str(app_model.id))
            app_model.access_mode = app_setting.access_mode

        permissions = enterprise_rbac_service.RBACService.MyPermissions.get(
            str(current_tenant_id),
            current_user.id,
            app_id=str(app_model.id),
            session=db.session(),
        )
        permission_keys_map = permissions.app.permission_keys_by_resource_ids([str(app_model.id)])

        response_model = AppDetailWithSite.model_validate(app_model, from_attributes=True).model_copy(
            update={"permission_keys": permission_keys_map.get(str(app_model.id), [])}
        )
        return response_model.model_dump(mode="json")

    @console_ns.doc("update_app")
    @console_ns.doc(description="Update application details")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[UpdateAppPayload.__name__])
    @console_ns.response(200, "App updated successfully", console_ns.models[AppDetailWithSite.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model(mode=None)
    def put(self, app_model: App):
        """Update app"""
        args = UpdateAppPayload.model_validate(console_ns.payload)

        app_service = AppService()

        args_dict: AppService.ArgsDict = {
            "name": args.name,
            "description": args.description or "",
            "icon_type": args.icon_type,
            "icon": args.icon or "",
            "icon_background": args.icon_background or "",
            "use_icon_as_answer_icon": args.use_icon_as_answer_icon or False,
            "max_active_requests": args.max_active_requests or 0,
        }
        app_model = app_service.update_app(app_model, args_dict, session=db.session())
        return dump_response(AppDetailWithSite, app_model)

    @console_ns.doc("delete_app")
    @console_ns.doc(description="Delete application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(204, "App deleted successfully")
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_DELETE)
    @get_app_model
    def delete(self, app_model: App):
        """Delete app"""
        app_service = AppService()
        app_service.delete_app(app_model, session=db.session())

        return "", 204


@console_ns.route("/apps/<uuid:app_id>/copy")
class AppCopyApi(Resource):
    @console_ns.doc("copy_app")
    @console_ns.doc(description="Create a copy of an existing application")
    @console_ns.doc(params={"app_id": "Application ID to copy"})
    @console_ns.expect(console_ns.models[CopyAppPayload.__name__])
    @console_ns.response(201, "App copied successfully", console_ns.models[AppDetailWithSite.__name__])
    @console_ns.response(202, "App copy requires confirmation", console_ns.models[AppImportResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_CREATE_AND_MANAGEMENT)
    @with_current_user
    @with_current_tenant_id
    @get_app_model(mode=None)
    def post(self, current_tenant_id: str, current_user: Account, app_model: App):
        """Copy app"""
        # The role of the current user in the ta table must be admin, owner, or editor
        args = CopyAppPayload.model_validate(console_ns.payload or {})

        with Session(db.engine, expire_on_commit=False) as session:
            import_service = AppDslService(session)
            yaml_content = import_service.export_dsl(app_model=app_model, session=session, include_secret=True)
            result = import_service.import_app(
                account=current_user,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=yaml_content,
                name=args.name,
                description=args.description,
                icon_type=args.icon_type,
                icon=args.icon,
                icon_background=args.icon_background,
            )
            if result.status == ImportStatus.FAILED:
                session.rollback()
                return dump_response(AppImportResponse, result), 400
            if result.status == ImportStatus.PENDING:
                session.rollback()
                return dump_response(AppImportResponse, result), 202
            session.commit()

            # Inherit web app permission from original app
            if result.app_id and FeatureService.get_system_features().webapp_auth.enabled:
                try:
                    # Get the original app's access mode
                    original_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_model.id)
                    access_mode = original_settings.access_mode
                except Exception:
                    # If original app has no settings (old app), default to public to match fallback behavior
                    access_mode = "public"

                # Apply the same access mode to the copied app
                EnterpriseService.WebAppAuth.update_app_access_mode(result.app_id, access_mode)

            stmt = select(App).where(App.id == result.app_id)
            app = session.scalar(stmt)

        if not app:
            raise NotFound("App not found")

        permission_keys_map = enterprise_rbac_service.RBACService.AppPermissions.batch_get(
            str(current_tenant_id),
            current_user.id,
            [str(app.id)],
            session=db.session(),
        )
        response_model = AppDetailWithSite.model_validate(app, from_attributes=True).model_copy(
            update={"permission_keys": permission_keys_map.get(str(app.id), [])}
        )
        return response_model.model_dump(mode="json"), 201


@console_ns.route("/apps/<uuid:app_id>/export")
class AppExportApi(Resource):
    @console_ns.doc("export_app")
    @console_ns.doc(description="Export application configuration as DSL")
    @console_ns.doc(params={"app_id": "Application ID to export"})
    @console_ns.doc(params=query_params_from_model(AppExportQuery))
    @console_ns.response(200, "App exported successfully", console_ns.models[AppExportResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_IMPORT_EXPORT_DSL)
    @get_app_model
    def get(self, app_model: App):
        """Export app"""
        args = AppExportQuery.model_validate(request.args.to_dict(flat=True))

        response = AppExportResponse(
            data=AppDslService.export_dsl(
                app_model=app_model,
                session=db.session(),
                include_secret=args.include_secret,
                workflow_id=args.workflow_id,
            )
        )
        return response.model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/publish-to-creators-platform")
class AppPublishToCreatorsPlatformApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[RedirectUrlResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_IMPORT_EXPORT_DSL)
    @with_current_user_id
    @get_app_model(mode=None)
    def post(self, current_user_id: str, app_model: App):
        """Publish app to Creators Platform"""
        from core.helper.creators import get_redirect_url, upload_dsl

        if not dify_config.CREATORS_PLATFORM_FEATURES_ENABLED:
            return {"error": "Creators Platform features are not enabled"}, 403

        dsl_content = AppDslService.export_dsl(app_model=app_model, session=db.session(), include_secret=False)
        dsl_bytes = dsl_content.encode("utf-8")

        claim_code = upload_dsl(dsl_bytes)
        redirect_url = get_redirect_url(current_user_id, claim_code)

        return RedirectUrlResponse(redirect_url=redirect_url).model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/name")
class AppNameApi(Resource):
    @console_ns.doc("check_app_name")
    @console_ns.doc(description="Check if app name is available")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppNamePayload.__name__])
    @console_ns.response(200, "Name availability checked", console_ns.models[AppDetail.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model(mode=None)
    def post(self, app_model: App):
        args = AppNamePayload.model_validate(console_ns.payload)

        app_service = AppService()
        app_model = app_service.update_app_name(app_model, args.name, session=db.session())
        return dump_response(AppDetail, app_model)


@console_ns.route("/apps/<uuid:app_id>/icon")
class AppIconApi(Resource):
    @console_ns.doc("update_app_icon")
    @console_ns.doc(description="Update application icon")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppIconPayload.__name__])
    @console_ns.response(200, "Icon updated successfully", console_ns.models[AppDetail.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model(mode=None)
    def post(self, app_model: App):
        args = AppIconPayload.model_validate(console_ns.payload or {})

        app_service = AppService()
        app_model = app_service.update_app_icon(
            app_model,
            args.icon or "",
            args.icon_background or "",
            args.icon_type,
            session=db.session(),
        )
        return dump_response(AppDetail, app_model)


@console_ns.route("/apps/<uuid:app_id>/site-enable")
class AppSiteStatus(Resource):
    @console_ns.doc("update_app_site_status")
    @console_ns.doc(description="Enable or disable app site")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppSiteStatusPayload.__name__])
    @console_ns.response(200, "Site status updated successfully", console_ns.models[AppDetail.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_RELEASE_AND_VERSION)
    @get_app_model(mode=None)
    def post(self, app_model: App):
        args = AppSiteStatusPayload.model_validate(console_ns.payload)

        app_service = AppService()
        app_model = app_service.update_app_site_status(app_model, args.enable_site, session=db.session())
        return dump_response(AppDetail, app_model)


@console_ns.route("/apps/<uuid:app_id>/api-enable")
class AppApiStatus(Resource):
    @console_ns.doc("update_app_api_status")
    @console_ns.doc(description="Enable or disable app API")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppApiStatusPayload.__name__])
    @console_ns.response(200, "API status updated successfully", console_ns.models[AppDetail.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_RELEASE_AND_VERSION)
    @get_app_model(mode=None)
    def post(self, app_model: App):
        args = AppApiStatusPayload.model_validate(console_ns.payload)

        app_service = AppService()
        app_model = app_service.update_app_api_status(app_model, args.enable_api, session=db.session())
        return dump_response(AppDetail, app_model)


@console_ns.route("/apps/<uuid:app_id>/trace")
class AppTraceApi(Resource):
    @console_ns.doc("get_app_trace")
    @console_ns.doc(description="Get app tracing configuration")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Trace configuration retrieved successfully",
        console_ns.models[AppTraceResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_session
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model
    def get(self, session: Session, app_model: App):
        """Get app trace"""
        app_trace_config = OpsTraceManager.get_app_tracing_config(app_model.id, session)

        return dump_response(AppTraceResponse, app_trace_config)

    @console_ns.doc("update_app_trace")
    @console_ns.doc(description="Update app tracing configuration")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppTracePayload.__name__])
    @console_ns.response(
        200,
        "Trace configuration updated successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TRACING_CONFIG)
    @get_app_model
    def post(self, app_model: App):
        # add app trace
        args = AppTracePayload.model_validate(console_ns.payload)

        OpsTraceManager.update_app_tracing_config(
            app_id=app_model.id,
            enabled=args.enabled,
            tracing_provider=args.tracing_provider,
        )

        return SimpleResultResponse(result="success").model_dump(mode="json")
