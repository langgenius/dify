import uuid
from dataclasses import asdict
from http import HTTPStatus
from typing import Literal, Self, override

from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator, model_validator
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from configs import dify_config
from controllers.common.fields import RedirectUrlResponse, SimpleResultResponse
from controllers.common.rbac import AgentBehindApp, PlainApp, RBACCheck, Workspace
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_enum_models,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError, TracingProviderUnavailableError
from controllers.console.flask_admission import console_account_admission
from controllers.console.workspace.models import LoadBalancingPayload
from controllers.console.wraps import (
    RBACPermission,
    validate_request,
)
from core.file.remote_file_metadata import FileInfo
from core.rag.entities import PreProcessingRule, Rule, Segmentation
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_application_services import application_services
from fields.app_fields import (
    AppDetail,
    AppDetailSiteResponse,
    AppDetailWithSite,
    AppExportResponse,
    AppImportResponse,
    AppModelConfigResponse,
    AppPagination,
    AppPartial,
    AppTraceResponse,
    DeletedTool,
    ModelConfigPartial,
    RecentAppListResponse,
    RecentAppResponse,
    Tag,
    WorkflowPartial,
)
from graphon.enums import WorkflowExecutionStatus
from libs.flask_restx_compat import BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY
from libs.helper import dump_response
from libs.url_utils import normalize_api_base_url
from machinery.context import RequestContext
from models import DatasetPermissionEnum
from models.account import TenantAccountRole
from models.model import IconType
from services.app.console_service import (
    AppExportAgentNotFoundError,
    AppExportPaidPlanRequiredError,
    ConsoleAppNotFoundError,
    CreatorsPlatformDisabledError,
    InvalidAppAccessModesError,
    InvalidAppExportError,
)
from services.app_tracing_config_service import (
    AppTracingConfigInvalidProviderError,
    AppTracingConfigProviderUnavailableError,
)
from services.entities.app_entities import (
    AppExportOptions,
    AppListParams,
    AppListSortBy,
    AppRecord,
    AppTraceSettings,
    CopyAppParams,
    CreateAppParams,
    StarredAppListParams,
    UpdateAppParams,
)
from services.entities.dsl_entities import ImportStatus
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
from services.errors.account import NoPermissionError

register_enum_models(console_ns, IconType)

AppListMode = Literal["completion", "chat", "advanced-chat", "workflow", "agent-chat", "agent", "channel", "all"]
DEFAULT_APP_LIST_MODE: AppListMode = "all"
APP_LIST_QUERY_ARRAY_FIELDS = ("tag_ids", "creator_ids")


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


class RecentAppListQuery(BaseModel):
    limit: int = Field(default=8, ge=1, le=8, description="Number of recently modified apps to return (1-8)")


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
    format: Literal["yaml", "ifpkg"] | None = Field(
        default=None, description="Export format; defaults to ifpkg for all Apps"
    )
    include_secret: bool = Field(default=False, description="Include secrets in export")
    workflow_id: str | None = Field(default=None, description="Specific workflow ID to export")
    version_id: uuid.UUID | None = Field(
        default=None,
        description=(
            "Published Agent version ID to export; requires a paid plan on Cloud. "
            "If omitted, exports the shared draft, falling back to the active snapshot when no draft exists."
        ),
    )

    @model_validator(mode="after")
    def validate_version_selectors(self) -> Self:
        if self.version_id is not None and self.workflow_id is not None:
            raise ValueError("version_id and workflow_id cannot be used together")
        return self


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


register_enum_models(console_ns, RetrievalMethod, WorkflowExecutionStatus, DatasetPermissionEnum)
register_response_schema_models(
    console_ns,
    RedirectUrlResponse,
    SimpleResultResponse,
    AppImportResponse,
    AppTraceResponse,
    AppModelConfigResponse,
    AppDetail,
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
    AppDetailSiteResponse,
    DeletedTool,
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
    RecentAppResponse,
    RecentAppListResponse,
    AppDetailWithSite,
    AppPagination,
)


_EDIT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})
_ADMIN_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})


def _app_detail_response(app: AppRecord) -> AppDetailWithSite:
    """Resolve transport URLs here so repositories work without a Flask request."""
    data = asdict(app)
    data["api_base_url"] = normalize_api_base_url(dify_config.SERVICE_API_URL or request.host_url.rstrip("/"))
    data["app_id"] = None
    if data["site"] is not None:
        data["site"]["app_base_url"] = dify_config.APP_WEB_URL or request.url_root.rstrip("/")
    return AppDetailWithSite.model_validate(data)


class AppResource(Resource):
    """Translate application failures at the HTTP boundary for all app routes."""

    @override
    def dispatch_request(self, *args, **kwargs):
        try:
            return super().dispatch_request(*args, **kwargs)
        except AppExportAgentNotFoundError as error:
            raise NotFound(str(error)) from error
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError() from error
        except (InvalidAppExportError, InvalidAppAccessModesError) as error:
            raise BadRequest(str(error)) from error
        except (AppExportPaidPlanRequiredError, NoPermissionError) as error:
            raise Forbidden(str(error)) from error
        except CreatorsPlatformDisabledError as error:
            return {"error": str(error)}, HTTPStatus.FORBIDDEN
        except AppTracingConfigInvalidProviderError as error:
            raise ValueError(str(error)) from error


@console_ns.route("/apps")
class AppListApi(AppResource):
    @console_ns.doc("list_apps")
    @console_ns.doc(description="Get list of applications with pagination and filtering")
    @console_ns.doc(params=query_params_from_model(AppListQuery))
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AppPagination.__name__])
    @console_account_admission(require_valid_enterprise_license=True)
    def get(self, context: RequestContext):
        args = query_params_from_request(AppListQuery, list_fields=APP_LIST_QUERY_ARRAY_FIELDS)
        params = AppListParams.model_validate(args.model_dump())
        return dump_response(
            AppPagination, application_services().apps.console.list_apps(context, params)
        ), HTTPStatus.OK

    @console_ns.doc("create_app")
    @console_ns.doc(description="Create a new application")
    @console_ns.expect(console_ns.models[CreateAppPayload.__name__])
    @console_ns.response(HTTPStatus.CREATED, "App created successfully", console_ns.models[AppDetailWithSite.__name__])
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid request parameters")
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        billing_resource="apps",
        rbac_checks=[RBACCheck(RBACPermission.APP_CREATE_AND_MANAGEMENT, Workspace())],
    )
    def post(self, context: RequestContext):
        payload = validate_request(CreateAppPayload)
        params = CreateAppParams.model_validate(payload.model_dump())
        response = _app_detail_response(application_services().apps.console.create(context, params))
        return dump_response(AppDetailWithSite, response), HTTPStatus.CREATED


@console_ns.route("/apps/recent")
class RecentAppListApi(AppResource):
    @console_ns.doc("list_recent_apps")
    @console_ns.doc(description="Get recently modified apps for the home Continue Work section")
    @console_ns.doc(params=query_params_from_model(RecentAppListQuery))
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[RecentAppListResponse.__name__])
    @console_account_admission(require_valid_enterprise_license=True)
    def get(self, context: RequestContext):
        args = query_params_from_request(RecentAppListQuery)
        return dump_response(
            RecentAppListResponse, {"data": application_services().apps.console.recent(context, args.limit)}
        ), HTTPStatus.OK


@console_ns.route("/apps/starred")
class StarredAppListApi(AppResource):
    @console_ns.doc("list_starred_apps")
    @console_ns.doc(description="Get applications starred by the current account")
    @console_ns.doc(params=query_params_from_model(StarredAppListQuery))
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AppPagination.__name__])
    @console_account_admission(require_valid_enterprise_license=True)
    def get(self, context: RequestContext):
        args = query_params_from_request(StarredAppListQuery, list_fields=APP_LIST_QUERY_ARRAY_FIELDS)
        params = StarredAppListParams.model_validate(args.model_dump())
        return dump_response(
            AppPagination, application_services().apps.console.list_apps(context, params)
        ), HTTPStatus.OK


@console_ns.route("/apps/<uuid:app_id>/star")
class AppStarApi(AppResource):
    @console_ns.doc("star_app")
    @console_ns.doc(description="Star an application for the current account")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(HTTPStatus.NOT_FOUND, "App not found")
    @console_account_admission(require_valid_enterprise_license=True)
    def post(self, context: RequestContext, app_id: uuid.UUID):
        application_services().apps.console.set_starred(context, str(app_id), True)
        return SimpleResultResponse(result="success").model_dump(mode="json")

    @console_ns.doc("unstar_app")
    @console_ns.doc(description="Remove the current account's star from an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(HTTPStatus.NOT_FOUND, "App not found")
    @console_account_admission(require_valid_enterprise_license=True)
    def delete(self, context: RequestContext, app_id: uuid.UUID):
        application_services().apps.console.set_starred(context, str(app_id), False)
        return SimpleResultResponse(result="success").model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>")
class AppApi(AppResource):
    @console_ns.doc("get_app_detail")
    @console_ns.doc(description="Get application details")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AppDetailWithSite.__name__])
    @console_account_admission(require_valid_enterprise_license=True)
    def get(self, context: RequestContext, app_id: uuid.UUID):
        response = _app_detail_response(application_services().apps.console.get(context, str(app_id)))
        return dump_response(AppDetailWithSite, response)

    @console_ns.doc("update_app")
    @console_ns.doc(description="Update application details")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[UpdateAppPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "App updated successfully", console_ns.models[AppDetailWithSite.__name__])
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid request parameters")
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_EDIT, PlainApp()),
            RBACCheck(RBACPermission.AGENT_EDIT, AgentBehindApp()),
        ],
    )
    def put(self, context: RequestContext, app_id: uuid.UUID):
        payload = validate_request(UpdateAppPayload)
        params = UpdateAppParams(
            name=payload.name,
            description=payload.description or "",
            icon_type=payload.icon_type,
            icon=payload.icon or "",
            icon_background=payload.icon_background or "",
            use_icon_as_answer_icon=payload.use_icon_as_answer_icon or False,
            max_active_requests=payload.max_active_requests or 0,
        )
        response = _app_detail_response(application_services().apps.console.update(context, str(app_id), params))
        return dump_response(AppDetailWithSite, response)

    @console_ns.doc("delete_app")
    @console_ns.doc(description="Delete application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(HTTPStatus.NO_CONTENT, "App deleted successfully")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_DELETE, PlainApp()),
            RBACCheck(RBACPermission.AGENT_DELETE, AgentBehindApp()),
        ],
    )
    def delete(self, context: RequestContext, app_id: uuid.UUID):
        application_services().apps.console.delete(context, str(app_id))
        return "", HTTPStatus.NO_CONTENT


@console_ns.route("/apps/<uuid:app_id>/copy")
class AppCopyApi(AppResource):
    @console_ns.doc("copy_app")
    @console_ns.doc(description="Create a copy of an existing application")
    @console_ns.doc(params={"app_id": "Application ID to copy"})
    @console_ns.expect(console_ns.models[CopyAppPayload.__name__])
    @console_ns.response(HTTPStatus.CREATED, "App copied successfully", console_ns.models[AppDetailWithSite.__name__])
    @console_ns.response(
        HTTPStatus.ACCEPTED, "App copy requires confirmation", console_ns.models[AppImportResponse.__name__]
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_CREATE_AND_MANAGEMENT, PlainApp())]
    )
    def post(self, context: RequestContext, app_id: uuid.UUID):
        payload = validate_request(CopyAppPayload)
        result, copied = application_services().apps.console.copy(
            context, str(app_id), CopyAppParams.model_validate(payload.model_dump())
        )
        if result.status == ImportStatus.FAILED:
            return dump_response(AppImportResponse, result), HTTPStatus.BAD_REQUEST
        if result.status == ImportStatus.PENDING:
            return dump_response(AppImportResponse, result), HTTPStatus.ACCEPTED
        assert copied is not None
        return dump_response(AppDetailWithSite, _app_detail_response(copied)), HTTPStatus.CREATED


@console_ns.route("/apps/<uuid:app_id>/export")
class AppExportApi(AppResource):
    @console_ns.doc("export_app")
    @console_ns.doc(description="Export application configuration as DSL")
    @console_ns.doc(params={"app_id": "Application ID to export"})
    @console_ns.doc(params=query_params_from_model(AppExportQuery))
    @console_ns.doc(
        produces=["application/json", "application/zip"],
        vendor={BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY: ["application/zip"]},
    )
    @console_ns.response(HTTPStatus.OK, "App exported successfully", console_ns.models[AppExportResponse.__name__])
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_IMPORT_EXPORT_DSL, PlainApp()),
            RBACCheck(RBACPermission.AGENT_IMPORT_EXPORT_DSL, AgentBehindApp()),
        ],
    )
    def get(self, context: RequestContext, app_id: uuid.UUID):
        query = validate_request(AppExportQuery)
        exported = application_services().apps.console.export(
            context, str(app_id), AppExportOptions(**query.model_dump())
        )
        if isinstance(exported, str):
            return AppExportResponse(data=exported).model_dump(mode="json")
        try:
            response = send_file(
                exported.archive, mimetype="application/zip", as_attachment=True, download_name=exported.filename
            )
        except Exception:
            exported.close()
            raise
        response.call_on_close(exported.close)
        return response


@console_ns.route("/apps/<uuid:app_id>/publish-to-creators-platform")
class AppPublishToCreatorsPlatformApi(AppResource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[RedirectUrlResponse.__name__])
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_IMPORT_EXPORT_DSL, PlainApp()),
            RBACCheck(RBACPermission.AGENT_RELEASE_AND_VERSION, AgentBehindApp()),
        ],
    )
    def post(self, context: RequestContext, app_id: uuid.UUID):
        url = application_services().apps.console.publish(context, str(app_id))
        return RedirectUrlResponse(redirect_url=url).model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/name")
class AppNameApi(AppResource):
    @console_ns.doc("check_app_name")
    @console_ns.doc(description="Check if app name is available")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppNamePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Name availability checked", console_ns.models[AppDetail.__name__])
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_EDIT, PlainApp()),
            RBACCheck(RBACPermission.AGENT_EDIT, AgentBehindApp()),
        ],
    )
    def post(self, context: RequestContext, app_id: uuid.UUID):
        payload = validate_request(AppNamePayload)
        return dump_response(AppDetail, application_services().apps.console.rename(context, str(app_id), payload.name))


@console_ns.route("/apps/<uuid:app_id>/icon")
class AppIconApi(AppResource):
    @console_ns.doc("update_app_icon")
    @console_ns.doc(description="Update application icon")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppIconPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Icon updated successfully", console_ns.models[AppDetail.__name__])
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_EDIT, PlainApp()),
            RBACCheck(RBACPermission.AGENT_EDIT, AgentBehindApp()),
        ],
    )
    def post(self, context: RequestContext, app_id: uuid.UUID):
        payload = validate_request(AppIconPayload)
        result = application_services().apps.console.update_icon(
            context,
            str(app_id),
            icon=payload.icon or "",
            icon_background=payload.icon_background or "",
            icon_type=payload.icon_type,
        )
        return dump_response(AppDetail, result)


@console_ns.route("/apps/<uuid:app_id>/site-enable")
class AppSiteStatus(AppResource):
    @console_ns.doc("update_app_site_status")
    @console_ns.doc(description="Enable or disable app site")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppSiteStatusPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Site status updated successfully", console_ns.models[AppDetail.__name__])
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp()),
            RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentBehindApp()),
        ],
    )
    def post(self, context: RequestContext, app_id: uuid.UUID):
        payload = validate_request(AppSiteStatusPayload)
        return dump_response(
            AppDetail, application_services().apps.console.set_site_enabled(context, str(app_id), payload.enable_site)
        )


@console_ns.route("/apps/<uuid:app_id>/api-enable")
class AppApiStatus(AppResource):
    @console_ns.doc("update_app_api_status")
    @console_ns.doc(description="Enable or disable app API")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppApiStatusPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "API status updated successfully", console_ns.models[AppDetail.__name__])
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=_ADMIN_ROLES,
        rbac_checks=[
            RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp()),
            RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentBehindApp()),
        ],
    )
    def post(self, context: RequestContext, app_id: uuid.UUID):
        payload = validate_request(AppApiStatusPayload)
        return dump_response(
            AppDetail, application_services().apps.console.set_api_enabled(context, str(app_id), payload.enable_api)
        )


@console_ns.route("/apps/<uuid:app_id>/trace")
class AppTraceApi(AppResource):
    @console_ns.doc("get_app_trace")
    @console_ns.doc(description="Get app tracing configuration")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        HTTPStatus.OK,
        "Trace configuration retrieved successfully",
        console_ns.models[AppTraceResponse.__name__],
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())])
    def get(self, context: RequestContext, app_id: uuid.UUID):
        return dump_response(AppTraceResponse, application_services().apps.console.get_trace(context, str(app_id)))

    @console_ns.doc("update_app_trace")
    @console_ns.doc(description="Update app tracing configuration")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppTracePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Trace configuration updated successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_TRACING_CONFIG, PlainApp())]
    )
    def post(self, context: RequestContext, app_id: uuid.UUID):
        payload = validate_request(AppTracePayload)
        try:
            application_services().apps.console.set_trace(
                context,
                str(app_id),
                AppTraceSettings(**payload.model_dump()),
            )
        except AppTracingConfigProviderUnavailableError as error:
            raise TracingProviderUnavailableError() from error
        return SimpleResultResponse(result="success").model_dump(mode="json")
