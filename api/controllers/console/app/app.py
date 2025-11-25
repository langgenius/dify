import uuid
from typing import Literal

from flask import request
from flask_restx import Resource, fields, marshal, marshal_with
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    edit_permission_required,
    enterprise_license_required,
    is_admin_or_owner_required,
    setup_required,
)
from core.ops.ops_trace_manager import OpsTraceManager
from core.workflow.enums import NodeType
from extensions.ext_database import db
from fields.app_fields import (
    deleted_tool_fields,
    model_config_fields,
    model_config_partial_fields,
    site_fields,
    tag_fields,
)
from fields.workflow_fields import workflow_partial_fields as _workflow_partial_fields_dict
from libs.helper import AppIconUrlField, TimestampField
from libs.login import current_account_with_tenant, login_required
from libs.validators import validate_description_length
from models import App, Workflow
from services.app_dsl_service import AppDslService, ImportMode
from services.app_service import AppService
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService

ALLOW_CREATE_APP_MODES = ["chat", "agent-chat", "advanced-chat", "workflow", "completion"]
DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


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
    description: str | None = Field(default=None, description="App description (max 400 chars)")
    mode: Literal["chat", "agent-chat", "advanced-chat", "workflow", "completion"] = Field(..., description="App mode")
    icon_type: str | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return validate_description_length(value)


class UpdateAppPayload(BaseModel):
    name: str = Field(..., min_length=1, description="App name")
    description: str | None = Field(default=None, description="App description (max 400 chars)")
    icon_type: str | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")
    use_icon_as_answer_icon: bool | None = Field(default=None, description="Use icon as answer icon")
    max_active_requests: int | None = Field(default=None, description="Maximum active requests")

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return validate_description_length(value)


class CopyAppPayload(BaseModel):
    name: str | None = Field(default=None, description="Name for the copied app")
    description: str | None = Field(default=None, description="Description for the copied app")
    icon_type: str | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return validate_description_length(value)


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


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(AppListQuery)
reg(CreateAppPayload)
reg(UpdateAppPayload)
reg(CopyAppPayload)
reg(AppExportQuery)
reg(AppNamePayload)
reg(AppIconPayload)
reg(AppSiteStatusPayload)
reg(AppApiStatusPayload)
reg(AppTracePayload)

# Register models for flask_restx to avoid dict type issues in Swagger
# Register base models first
tag_model = console_ns.model("Tag", tag_fields)

workflow_partial_model = console_ns.model("WorkflowPartial", _workflow_partial_fields_dict)

model_config_model = console_ns.model("ModelConfig", model_config_fields)

model_config_partial_model = console_ns.model("ModelConfigPartial", model_config_partial_fields)

deleted_tool_model = console_ns.model("DeletedTool", deleted_tool_fields)

site_model = console_ns.model("Site", site_fields)

app_partial_model = console_ns.model(
    "AppPartial",
    {
        "id": fields.String,
        "name": fields.String,
        "max_active_requests": fields.Raw(),
        "description": fields.String(attribute="desc_or_prompt"),
        "mode": fields.String(attribute="mode_compatible_with_agent"),
        "icon_type": fields.String,
        "icon": fields.String,
        "icon_background": fields.String,
        "icon_url": AppIconUrlField,
        "model_config": fields.Nested(model_config_partial_model, attribute="app_model_config", allow_null=True),
        "workflow": fields.Nested(workflow_partial_model, allow_null=True),
        "use_icon_as_answer_icon": fields.Boolean,
        "created_by": fields.String,
        "created_at": TimestampField,
        "updated_by": fields.String,
        "updated_at": TimestampField,
        "tags": fields.List(fields.Nested(tag_model)),
        "access_mode": fields.String,
        "create_user_name": fields.String,
        "author_name": fields.String,
        "has_draft_trigger": fields.Boolean,
    },
)

app_detail_model = console_ns.model(
    "AppDetail",
    {
        "id": fields.String,
        "name": fields.String,
        "description": fields.String,
        "mode": fields.String(attribute="mode_compatible_with_agent"),
        "icon": fields.String,
        "icon_background": fields.String,
        "enable_site": fields.Boolean,
        "enable_api": fields.Boolean,
        "model_config": fields.Nested(model_config_model, attribute="app_model_config", allow_null=True),
        "workflow": fields.Nested(workflow_partial_model, allow_null=True),
        "tracing": fields.Raw,
        "use_icon_as_answer_icon": fields.Boolean,
        "created_by": fields.String,
        "created_at": TimestampField,
        "updated_by": fields.String,
        "updated_at": TimestampField,
        "access_mode": fields.String,
        "tags": fields.List(fields.Nested(tag_model)),
    },
)

app_detail_with_site_model = console_ns.model(
    "AppDetailWithSite",
    {
        "id": fields.String,
        "name": fields.String,
        "description": fields.String,
        "mode": fields.String(attribute="mode_compatible_with_agent"),
        "icon_type": fields.String,
        "icon": fields.String,
        "icon_background": fields.String,
        "icon_url": AppIconUrlField,
        "enable_site": fields.Boolean,
        "enable_api": fields.Boolean,
        "model_config": fields.Nested(model_config_model, attribute="app_model_config", allow_null=True),
        "workflow": fields.Nested(workflow_partial_model, allow_null=True),
        "api_base_url": fields.String,
        "use_icon_as_answer_icon": fields.Boolean,
        "max_active_requests": fields.Integer,
        "created_by": fields.String,
        "created_at": TimestampField,
        "updated_by": fields.String,
        "updated_at": TimestampField,
        "deleted_tools": fields.List(fields.Nested(deleted_tool_model)),
        "access_mode": fields.String,
        "tags": fields.List(fields.Nested(tag_model)),
        "site": fields.Nested(site_model),
    },
)

app_pagination_model = console_ns.model(
    "AppPagination",
    {
        "page": fields.Integer,
        "limit": fields.Integer(attribute="per_page"),
        "total": fields.Integer,
        "has_more": fields.Boolean(attribute="has_next"),
        "data": fields.List(fields.Nested(app_partial_model), attribute="items"),
    },
)


@console_ns.route("/apps")
class AppListApi(Resource):
    @console_ns.doc("list_apps")
    @console_ns.doc(description="Get list of applications with pagination and filtering")
    @console_ns.expect(console_ns.models[AppListQuery.__name__])
    @console_ns.response(200, "Success", app_pagination_model)
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
            return {"data": [], "total": 0, "page": 1, "limit": 20, "has_more": False}

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

        return marshal(app_pagination, app_pagination_model), 200

    @console_ns.doc("create_app")
    @console_ns.doc(description="Create a new application")
    @console_ns.expect(console_ns.models[CreateAppPayload.__name__])
    @console_ns.response(201, "App created successfully", app_detail_model)
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_model)
    @cloud_edition_billing_resource_check("apps")
    @edit_permission_required
    def post(self):
        """Create app"""
        current_user, current_tenant_id = current_account_with_tenant()
        args = CreateAppPayload.model_validate(console_ns.payload)

        app_service = AppService()
        app = app_service.create_app(current_tenant_id, args.model_dump(), current_user)

        return app, 201


@console_ns.route("/apps/<uuid:app_id>")
class AppApi(Resource):
    @console_ns.doc("get_app_detail")
    @console_ns.doc(description="Get application details")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Success", app_detail_with_site_model)
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @get_app_model
    @marshal_with(app_detail_with_site_model)
    def get(self, app_model):
        """Get app detail"""
        app_service = AppService()

        app_model = app_service.get_app(app_model)

        if FeatureService.get_system_features().webapp_auth.enabled:
            app_setting = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=str(app_model.id))
            app_model.access_mode = app_setting.access_mode

        return app_model

    @console_ns.doc("update_app")
    @console_ns.doc(description="Update application details")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[UpdateAppPayload.__name__])
    @console_ns.response(200, "App updated successfully", app_detail_with_site_model)
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @edit_permission_required
    @marshal_with(app_detail_with_site_model)
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

        return app_model

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
    @console_ns.response(201, "App copied successfully", app_detail_with_site_model)
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @edit_permission_required
    @marshal_with(app_detail_with_site_model)
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

        return app, 201


@console_ns.route("/apps/<uuid:app_id>/export")
class AppExportApi(Resource):
    @console_ns.doc("export_app")
    @console_ns.doc(description="Export application configuration as DSL")
    @console_ns.doc(params={"app_id": "Application ID to export"})
    @console_ns.expect(console_ns.models[AppExportQuery.__name__])
    @console_ns.response(
        200,
        "App exported successfully",
        console_ns.model("AppExportResponse", {"data": fields.String(description="DSL export data")}),
    )
    @console_ns.response(403, "Insufficient permissions")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, app_model):
        """Export app"""
        args = AppExportQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        return {
            "data": AppDslService.export_dsl(
                app_model=app_model,
                include_secret=args.include_secret,
                workflow_id=args.workflow_id,
            )
        }


@console_ns.route("/apps/<uuid:app_id>/name")
class AppNameApi(Resource):
    @console_ns.doc("check_app_name")
    @console_ns.doc(description="Check if app name is available")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppNamePayload.__name__])
    @console_ns.response(200, "Name availability checked")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_model)
    @edit_permission_required
    def post(self, app_model):
        args = AppNamePayload.model_validate(console_ns.payload)

        app_service = AppService()
        app_model = app_service.update_app_name(app_model, args.name)

        return app_model


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
    @get_app_model
    @marshal_with(app_detail_model)
    @edit_permission_required
    def post(self, app_model):
        args = AppIconPayload.model_validate(console_ns.payload or {})

        app_service = AppService()
        app_model = app_service.update_app_icon(app_model, args.icon or "", args.icon_background or "")

        return app_model


@console_ns.route("/apps/<uuid:app_id>/site-enable")
class AppSiteStatus(Resource):
    @console_ns.doc("update_app_site_status")
    @console_ns.doc(description="Enable or disable app site")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppSiteStatusPayload.__name__])
    @console_ns.response(200, "Site status updated successfully", app_detail_model)
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_model)
    @edit_permission_required
    def post(self, app_model):
        args = AppSiteStatusPayload.model_validate(console_ns.payload)

        app_service = AppService()
        app_model = app_service.update_app_site_status(app_model, args.enable_site)

        return app_model


@console_ns.route("/apps/<uuid:app_id>/api-enable")
class AppApiStatus(Resource):
    @console_ns.doc("update_app_api_status")
    @console_ns.doc(description="Enable or disable app API")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppApiStatusPayload.__name__])
    @console_ns.response(200, "API status updated successfully", app_detail_model)
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_model)
    def post(self, app_model):
        args = AppApiStatusPayload.model_validate(console_ns.payload)

        app_service = AppService()
        app_model = app_service.update_app_api_status(app_model, args.enable_api)

        return app_model


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
