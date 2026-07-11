from flask import Blueprint
from flask_restx import Namespace

from controllers.openapi._errors import ErrorBody, OpenApiErrorCode, OpenApiErrorFormatter
from controllers.openapi._version_gate import attach_version_gate
from libs.device_flow_security import attach_anti_framing
from libs.external_api import ExternalApi

bp = Blueprint("openapi", __name__, url_prefix="/openapi/v1")
attach_anti_framing(bp)
attach_version_gate(bp)

api = ExternalApi(
    bp,
    version="1.0",
    title="OpenAPI",
    description="User-scoped programmatic API (bearer auth)",
    error_body_formatter=OpenApiErrorFormatter(),
)

openapi_ns = Namespace("openapi", description="User-scoped operations", path="/")

# Register response/query models BEFORE importing controller modules so that
# @openapi_ns.response / @openapi_ns.expect decorators can resolve model names.
from controllers.common.fields import EventStreamResponse, SimpleResultResponse
from controllers.common.schema import register_enum_models, register_response_schema_models, register_schema_models
from controllers.openapi._models import (
    AccountPayload,
    AccountResponse,
    AppDescribeInfo,
    AppDescribeQuery,
    AppDescribeResponse,
    AppDiscoveryItem,
    AppDiscoveryModel,
    AppDiscoveryQuery,
    AppDiscoveryResponse,
    AppDiscoveryTool,
    AppDslExportQuery,
    AppDslExportResponse,
    AppDslImportPayload,
    AppInfo,
    AppListQuery,
    AppListResponse,
    AppListRow,
    AppRunRequest,
    DeviceCodeRequest,
    DeviceCodeResponse,
    DeviceLookupQuery,
    DeviceLookupResponse,
    DeviceMutateRequest,
    DeviceMutateResponse,
    DevicePollRequest,
    DeviceTokenResponse,
    FormSubmitResponse,
    HealthResponse,
    HumanInputFormDefinitionResponse,
    MemberActionResponse,
    MemberInvitePayload,
    MemberInviteResponse,
    MemberListQuery,
    MemberListResponse,
    MemberResponse,
    MemberRoleUpdatePayload,
    MessageMetadata,
    PermittedExternalAppsListQuery,
    PermittedExternalAppsListResponse,
    RevokeResponse,
    ServerVersionResponse,
    SessionListQuery,
    SessionListResponse,
    SessionRow,
    TaskStopResponse,
    UsageInfo,
    WorkflowRunData,
    WorkspaceDetailResponse,
    WorkspaceListResponse,
    WorkspacePayload,
    WorkspaceSummaryResponse,
)
from fields.file_fields import FileResponse
from services.app_dsl_service import Import
from services.entities.dsl_entities import CheckDependenciesResult

register_schema_models(
    openapi_ns,
    AppDescribeQuery,
    AppDiscoveryQuery,
    AppDslImportPayload,
    AppDslExportQuery,
    AppListQuery,
    AppRunRequest,
    DeviceCodeRequest,
    DevicePollRequest,
    DeviceLookupQuery,
    DeviceMutateRequest,
    MemberInvitePayload,
    MemberListQuery,
    MemberRoleUpdatePayload,
    PermittedExternalAppsListQuery,
    SessionListQuery,
)
register_response_schema_models(
    openapi_ns,
    ErrorBody,
    EventStreamResponse,
    SimpleResultResponse,
    UsageInfo,
    MessageMetadata,
    AppListRow,
    AppListResponse,
    AppInfo,
    AppDescribeInfo,
    AppDescribeResponse,
    AppDiscoveryTool,
    AppDiscoveryModel,
    AppDiscoveryItem,
    AppDiscoveryResponse,
    AppDslExportResponse,
    Import,
    CheckDependenciesResult,
    WorkflowRunData,
    AccountPayload,
    WorkspacePayload,
    AccountResponse,
    SessionRow,
    SessionListResponse,
    PermittedExternalAppsListResponse,
    RevokeResponse,
    WorkspaceSummaryResponse,
    WorkspaceListResponse,
    WorkspaceDetailResponse,
    MemberResponse,
    MemberListResponse,
    MemberInviteResponse,
    MemberActionResponse,
    TaskStopResponse,
    FormSubmitResponse,
    HumanInputFormDefinitionResponse,
    DeviceCodeResponse,
    DeviceTokenResponse,
    DeviceLookupResponse,
    DeviceMutateResponse,
    FileResponse,
    ServerVersionResponse,
    HealthResponse,
)
# Standalone definition for contract codegen; ErrorBody.code stays an open
# string on the wire so old clients keep parsing future codes.
register_enum_models(openapi_ns, OpenApiErrorCode)

from . import (
    _meta,
    account,
    app_dsl,
    app_run,
    apps,
    apps_permitted_external,
    files,
    human_input_form,
    index,
    oauth_device,
    oauth_device_sso,
    workflow_events,
    workspaces,
)

# Request models are imported from _models.py and registered above.

__all__ = [
    "_meta",
    "account",
    "app_dsl",
    "app_run",
    "apps",
    "apps_permitted_external",
    "files",
    "human_input_form",
    "index",
    "oauth_device",
    "oauth_device_sso",
    "workflow_events",
    "workspaces",
]

api.add_namespace(openapi_ns)
