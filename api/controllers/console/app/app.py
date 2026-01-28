import uuid
from datetime import datetime
from typing import Any, Literal, TypeAlias

from flask import request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, computed_field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from controllers.common.helpers import FileInfo
from controllers.common.schema import register_enum_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.workspace.models import LoadBalancingPayload
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    edit_permission_required,
    enterprise_license_required,
    is_admin_or_owner_required,
    setup_required,
)
from core.file import helpers as file_helpers
from core.ops.ops_trace_manager import OpsTraceManager
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.workflow.enums import NodeType, WorkflowExecutionStatus
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models import App, DatasetPermissionEnum, Workflow
from models.model import IconType
from services.app_dsl_service import AppDslService, ImportMode
from services.app_service import AppService
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.knowledge_entities.knowledge_entities import (
    DataSource,
    InfoList,
    NotionIcon,
    NotionInfo,
    NotionPage,
    PreProcessingRule,
    RerankingModel,
    Rule,
    Segmentation,
    WebsiteInfo,
    WeightKeywordSetting,
    WeightModel,
    WeightVectorSetting,
)
from services.feature_service import FeatureService

ALLOW_CREATE_APP_MODES = ["chat", "agent-chat", "advanced-chat", "workflow", "completion"]

register_enum_models(console_ns, IconType)


class AppListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999, description="Page number (1-99999)")
    limit: int = Field(default=20, ge=1, le=100, description="Page size (1-100)")
    mode: Literal["completion", "chat", "advanced-chat", "workflow", "agent-chat", "channel", "all"] = Field(
        default="all", description="App mode filter"
    )
    name: str | None = Field(default=None, description="Filter by app name")
    tag_ids: list[str] | None = Field(default=None, description="Comma-separated tag IDs")
    is_created_by_me: bool | None = Field(default=None, description="Filter by creator")

    @field_validator("tag_ids", mode="before")
    @classmethod
    def validate_tag_ids(cls, value: str | list[str] | None) -> list[str] | None:
        if not value:
            return None

        if isinstance(value, str):
            items = [item.strip() for item in value.split(",") if item.strip()]
        elif isinstance(value, list):
            items = [str(item).strip() for item in value if item and str(item).strip()]
        else:
            raise TypeError("Unsupported tag_ids type.")

        if not items:
            return None

        try:
            return [str(uuid.UUID(item)) for item in items]
        except ValueError as exc:
            raise ValueError("Invalid UUID format in tag_ids.") from exc


class CreateAppPayload(BaseModel):
    name: str = Field(..., min_length=1, description="App name")
    description: str | None = Field(default=None, description="App description (max 400 chars)", max_length=400)
    mode: Literal["chat", "agent-chat", "advanced-chat", "workflow", "completion"] = Field(..., description="App mode")
    icon_type: str | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")


class UpdateAppPayload(BaseModel):
    name: str = Field(..., min_length=1, description="App name")
    description: str | None = Field(default=None, description="App description (max 400 chars)", max_length=400)
    icon_type: str | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")
    use_icon_as_answer_icon: bool | None = Field(default=None, description="Use icon as answer icon")
    max_active_requests: int | None = Field(default=None, description="Maximum active requests")


class CopyAppPayload(BaseModel):
    name: str | None = Field(default=None, description="Name for the copied app")
    description: str | None = Field(default=None, description="Description for the copied app", max_length=400)
    icon_type: str | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")


class AppExportQuery(BaseModel):
    include_secret: bool = Field(default=False, description="Include secrets in export")
    workflow_id: str | None = Field(default=None, description="Specific workflow ID to export")


class AppNamePayload(BaseModel):
    name: str = Field(..., min_length=1, description="Name to check")


class AppIconPayload(BaseModel):
    icon: str | None = Field(default=None, description="Icon data")
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


JSONValue: TypeAlias = Any


class ResponseModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="ignore",
        populate_by_name=True,
        serialize_by_alias=True,
        protected_namespaces=(),
    )


def _to_timestamp(value: datetime | int | None) -> int | None:
    if isinstance(value, datetime):
        return int(value.timestamp())
    return value


def _build_icon_url(icon_type: str | IconType | None, icon: str | None) -> str | None:
    if icon is None or icon_type is None:
        return None
    icon_type_value = icon_type.value if isinstance(icon_type, IconType) else str(icon_type)
    if icon_type_value.lower() != IconType.IMAGE:
        return None
    return file_helpers.get_signed_file_url(icon)


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
        return _to_timestamp(value)


class ModelConfigPartial(ResponseModel):
    model: JSONValue | None = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    pre_prompt: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class ModelConfig(ResponseModel):
    opening_statement: str | None = None
    suggested_questions: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("suggested_questions_list", "suggested_questions")
    )
    suggested_questions_after_answer: JSONValue | None = Field(
        default=None,
        validation_alias=AliasChoices("suggested_questions_after_answer_dict", "suggested_questions_after_answer"),
    )
    speech_to_text: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("speech_to_text_dict", "speech_to_text")
    )
    text_to_speech: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("text_to_speech_dict", "text_to_speech")
    )
    retriever_resource: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("retriever_resource_dict", "retriever_resource")
    )
    annotation_reply: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("annotation_reply_dict", "annotation_reply")
    )
    more_like_this: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("more_like_this_dict", "more_like_this")
    )
    sensitive_word_avoidance: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("sensitive_word_avoidance_dict", "sensitive_word_avoidance")
    )
    external_data_tools: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("external_data_tools_list", "external_data_tools")
    )
    model: JSONValue | None = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    user_input_form: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("user_input_form_list", "user_input_form")
    )
    dataset_query_variable: str | None = None
    pre_prompt: str | None = None
    agent_mode: JSONValue | None = Field(default=None, validation_alias=AliasChoices("agent_mode_dict", "agent_mode"))
    prompt_type: str | None = None
    chat_prompt_config: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("chat_prompt_config_dict", "chat_prompt_config")
    )
    completion_prompt_config: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("completion_prompt_config_dict", "completion_prompt_config")
    )
    dataset_configs: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("dataset_configs_dict", "dataset_configs")
    )
    file_upload: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("file_upload_dict", "file_upload")
    )
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class Site(ResponseModel):
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
        return _build_icon_url(self.icon_type, self.icon)

    @field_validator("icon_type", mode="before")
    @classmethod
    def _normalize_icon_type(cls, value: str | IconType | None) -> str | None:
        if isinstance(value, IconType):
            return value.value
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


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

    @computed_field(return_type=str | None)  # type: ignore
    @property
    def icon_url(self) -> str | None:
        return _build_icon_url(self.icon_type, self.icon)

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


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
    tracing: JSONValue | None = None
    use_icon_as_answer_icon: bool | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None
    access_mode: str | None = None
    tags: list[Tag] = Field(default_factory=list)

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class AppDetailWithSite(AppDetail):
    icon_type: str | None = None
    api_base_url: str | None = None
    max_active_requests: int | None = None
    deleted_tools: list[DeletedTool] = Field(default_factory=list)
    site: Site | None = None

    @computed_field(return_type=str | None)  # type: ignore
    @property
    def icon_url(self) -> str | None:
        return _build_icon_url(self.icon_type, self.icon)


class AppPagination(ResponseModel):
    page: int
    limit: int = Field(validation_alias=AliasChoices("per_page", "limit"))
    total: int
    has_more: bool = Field(validation_alias=AliasChoices("has_next", "has_more"))
    data: list[AppPartial] = Field(validation_alias=AliasChoices("items", "data"))


class AppExportResponse(ResponseModel):
    data: str


register_enum_models(console_ns, RetrievalMethod, WorkflowExecutionStatus, DatasetPermissionEnum)

register_schema_models(
    console_ns,
    AppListQuery,
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
    Site,
    DeletedTool,
    AppPartial,
    AppDetail,
    AppDetailWithSite,
    AppPagination,
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


@console_ns.route("/apps")
class AppListApi(Resource):
    @console_ns.doc("list_apps")
    @console_ns.doc(description="Get list of applications with pagination and filtering")
    @console_ns.expect(console_ns.models[AppListQuery.__name__])
    @console_ns.response(200, "Success", console_ns.models[AppPagination.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        """Get app list"""
        current_user, current_tenant_id = current_account_with_tenant()

        args = AppListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        args_dict = args.model_dump()

        # get app list
        app_service = AppService()
        app_pagination = app_service.get_paginate_apps(current_user.id, current_tenant_id, args_dict)
        if not app_pagination:
            empty = AppPagination(page=args.page, limit=args.limit, total=0, has_more=False, data=[])
            return empty.model_dump(mode="json"), 200

        if FeatureService.get_system_features().webapp_auth.enabled:
            app_ids = [str(app.id) for app in app_pagination.items]
            res = EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id(app_ids=app_ids)
            if len(res) != len(app_ids):
                raise BadRequest("Invalid app id in webapp auth")

            for app in app_pagination.items:
                if str(app.id) in res:
                    app.access_mode = res[str(app.id)].access_mode

        workflow_capable_app_ids = [
            str(app.id) for app in app_pagination.items if app.mode in {"workflow", "advanced-chat"}
        ]
        draft_trigger_app_ids: set[str] = set()
        if workflow_capable_app_ids:
            draft_workflows = (
                db.session.execute(
                    select(Workflow).where(
                        Workflow.version == Workflow.VERSION_DRAFT,
                        Workflow.app_id.in_(workflow_capable_app_ids),
                    )
                )
                .scalars()
                .all()
            )
            trigger_node_types = {
                NodeType.TRIGGER_WEBHOOK,
                NodeType.TRIGGER_SCHEDULE,
                NodeType.TRIGGER_PLUGIN,
            }
            for workflow in draft_workflows:
                try:
                    for _, node_data in workflow.walk_nodes():
                        if node_data.get("type") in trigger_node_types:
                            draft_trigger_app_ids.add(str(workflow.app_id))
                            break
                except Exception:
                    continue

        for app in app_pagination.items:
            app.has_draft_trigger = str(app.id) in draft_trigger_app_ids

        pagination_model = AppPagination.model_validate(app_pagination, from_attributes=True)
        return pagination_model.model_dump(mode="json"), 200

    @console_ns.doc("create_app")
    @console_ns.doc(description="Create a new application")
    @console_ns.expect(console_ns.models[CreateAppPayload.__name__])
    @console_ns.response(201, "App created successfully", console_ns.models[AppDetail.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("apps")
    @edit_permission_required
    def post(self):
        """Create app"""
        current_user, current_tenant_id = current_account_with_tenant()
        args = CreateAppPayload.model_validate(console_ns.payload)

        app_service = AppService()
        app = app_service.create_app(current_tenant_id, args.model_dump(), current_user)
        app_detail = AppDetail.model_validate(app, from_attributes=True)
        return app_detail.model_dump(mode="json"), 201


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
    @get_app_model(mode=None)
    def get(self, app_model):
        """Get app detail"""
        app_service = AppService()

        app_model = app_service.get_app(app_model)

        if FeatureService.get_system_features().webapp_auth.enabled:
            app_setting = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=str(app_model.id))
            app_model.access_mode = app_setting.access_mode

        response_model = AppDetailWithSite.model_validate(app_model, from_attributes=True)
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
    @get_app_model(mode=None)
    @edit_permission_required
    def put(self, app_model):
        """Update app"""
        args = UpdateAppPayload.model_validate(console_ns.payload)

        app_service = AppService()

        args_dict: AppService.ArgsDict = {
            "name": args.name,
            "description": args.description or "",
            "icon_type": args.icon_type or "",
            "icon": args.icon or "",
            "icon_background": args.icon_background or "",
            "use_icon_as_answer_icon": args.use_icon_as_answer_icon or False,
            "max_active_requests": args.max_active_requests or 0,
        }
        app_model = app_service.update_app(app_model, args_dict)
        response_model = AppDetailWithSite.model_validate(app_model, from_attributes=True)
        return response_model.model_dump(mode="json")

    @console_ns.doc("delete_app")
    @console_ns.doc(description="Delete application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(204, "App deleted successfully")
    @console_ns.response(403, "Insufficient permissions")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def delete(self, app_model):
        """Delete app"""
        app_service = AppService()
        app_service.delete_app(app_model)

        return {"result": "success"}, 204


@console_ns.route("/apps/<uuid:app_id>/copy")
class AppCopyApi(Resource):
    @console_ns.doc("copy_app")
    @console_ns.doc(description="Create a copy of an existing application")
    @console_ns.doc(params={"app_id": "Application ID to copy"})
    @console_ns.expect(console_ns.models[CopyAppPayload.__name__])
    @console_ns.response(201, "App copied successfully", console_ns.models[AppDetailWithSite.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=None)
    @edit_permission_required
    def post(self, app_model):
        """Copy app"""
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, _ = current_account_with_tenant()

        args = CopyAppPayload.model_validate(console_ns.payload or {})

        with Session(db.engine) as session:
            import_service = AppDslService(session)
            yaml_content = import_service.export_dsl(app_model=app_model, include_secret=True)
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
            session.commit()

            stmt = select(App).where(App.id == result.app_id)
            app = session.scalar(stmt)

        response_model = AppDetailWithSite.model_validate(app, from_attributes=True)
        return response_model.model_dump(mode="json"), 201


@console_ns.route("/apps/<uuid:app_id>/export")
class AppExportApi(Resource):
    @console_ns.doc("export_app")
    @console_ns.doc(description="Export application configuration as DSL")
    @console_ns.doc(params={"app_id": "Application ID to export"})
    @console_ns.expect(console_ns.models[AppExportQuery.__name__])
    @console_ns.response(200, "App exported successfully", console_ns.models[AppExportResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, app_model):
        """Export app"""
        args = AppExportQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        payload = AppExportResponse(
            data=AppDslService.export_dsl(
                app_model=app_model,
                include_secret=args.include_secret,
                workflow_id=args.workflow_id,
            )
        )
        return payload.model_dump(mode="json")


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
    @get_app_model(mode=None)
    @edit_permission_required
    def post(self, app_model):
        args = AppNamePayload.model_validate(console_ns.payload)

        app_service = AppService()
        app_model = app_service.update_app_name(app_model, args.name)
        response_model = AppDetail.model_validate(app_model, from_attributes=True)
        return response_model.model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/icon")
class AppIconApi(Resource):
    @console_ns.doc("update_app_icon")
    @console_ns.doc(description="Update application icon")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppIconPayload.__name__])
    @console_ns.response(200, "Icon updated successfully")
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=None)
    @edit_permission_required
    def post(self, app_model):
        args = AppIconPayload.model_validate(console_ns.payload or {})

        app_service = AppService()
        app_model = app_service.update_app_icon(app_model, args.icon or "", args.icon_background or "")
        response_model = AppDetail.model_validate(app_model, from_attributes=True)
        return response_model.model_dump(mode="json")


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
    @get_app_model(mode=None)
    @edit_permission_required
    def post(self, app_model):
        args = AppSiteStatusPayload.model_validate(console_ns.payload)

        app_service = AppService()
        app_model = app_service.update_app_site_status(app_model, args.enable_site)
        response_model = AppDetail.model_validate(app_model, from_attributes=True)
        return response_model.model_dump(mode="json")


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
    @get_app_model(mode=None)
    def post(self, app_model):
        args = AppApiStatusPayload.model_validate(console_ns.payload)

        app_service = AppService()
        app_model = app_service.update_app_api_status(app_model, args.enable_api)
        response_model = AppDetail.model_validate(app_model, from_attributes=True)
        return response_model.model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/trace")
class AppTraceApi(Resource):
    @console_ns.doc("get_app_trace")
    @console_ns.doc(description="Get app tracing configuration")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Trace configuration retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        """Get app trace"""
        app_trace_config = OpsTraceManager.get_app_tracing_config(app_id=app_id)

        return app_trace_config

    @console_ns.doc("update_app_trace")
    @console_ns.doc(description="Update app tracing configuration")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppTracePayload.__name__])
    @console_ns.response(200, "Trace configuration updated successfully")
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, app_id):
        # add app trace
        args = AppTracePayload.model_validate(console_ns.payload)

        OpsTraceManager.update_app_tracing_config(
            app_id=app_id,
            enabled=args.enabled,
            tracing_provider=args.tracing_provider,
        )

        return {"result": "success"}
