from flask import Blueprint
from flask_restx import Namespace

from libs.device_flow_security import attach_anti_framing
from libs.external_api import ExternalApi

bp = Blueprint("openapi", __name__, url_prefix="/openapi/v1")
attach_anti_framing(bp)

api = ExternalApi(
    bp,
    version="1.0",
    title="OpenAPI",
    description="User-scoped programmatic API (bearer auth)",
)

openapi_ns = Namespace("openapi", description="User-scoped operations", path="/")

# Register response/query models BEFORE importing controller modules so that
# @openapi_ns.response / @openapi_ns.expect decorators can resolve model names.
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.openapi._models import (
    AccountPayload,
    AccountResponse,
    AppDescribeInfo,
    AppDescribeQuery,
    AppDescribeResponse,
    AppInfoResponse,
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
    SessionListResponse,
    SessionRow,
    TagItem,
    UsageInfo,
    WorkflowRunData,
    WorkspaceDetailResponse,
    WorkspaceListResponse,
    WorkspacePayload,
    WorkspaceSummaryResponse,
)
from fields.file_fields import FileResponse

register_schema_models(
    openapi_ns,
    AppDescribeQuery,
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
)
register_response_schema_models(
    openapi_ns,
    TagItem,
    UsageInfo,
    MessageMetadata,
    AppListRow,
    AppListResponse,
    AppInfoResponse,
    AppDescribeInfo,
    AppDescribeResponse,
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
    DeviceCodeResponse,
    DeviceLookupResponse,
    DeviceMutateResponse,
    FileResponse,
    ServerVersionResponse,
)

from . import (
    _meta,
    account,
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
