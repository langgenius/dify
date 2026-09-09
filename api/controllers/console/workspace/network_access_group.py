from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, ValidationError, model_validator
from werkzeug.exceptions import BadGateway, BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_paid_plan_required,
    is_cloud_edition_billing_paid_plan,
    model_validate,
    only_edition_cloud,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from models import Account, App, AppMode, TenantAccountRole
from services.billing_service import BillingService, NetworkAccessGroupUpstreamError
from services.network_access_group_service import NetworkAccessGroupService

NetworkAccessPoint = Literal["webapp", "service_api", "mcp", "trigger"]

_ACCESS_POINTS_BY_APP_MODE: dict[AppMode, tuple[NetworkAccessPoint, ...]] = {
    AppMode.WORKFLOW: ("webapp", "service_api", "mcp", "trigger"),
    AppMode.ADVANCED_CHAT: ("webapp", "service_api", "mcp"),
    AppMode.CHAT: ("webapp", "service_api", "mcp"),
    AppMode.COMPLETION: ("webapp", "service_api", "mcp"),
    AppMode.AGENT_CHAT: ("webapp", "service_api"),
}


class NetworkAccessGroupCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    allowed_cidrs: list[str] = Field(min_length=1, max_length=100)


class NetworkAccessGroupUpdatePayload(NetworkAccessGroupCreatePayload):
    expected_version: int = Field(ge=1)


class NetworkAccessGroupDeleteQuery(BaseModel):
    expected_version: int = Field(ge=1, description="Current group version used for optimistic concurrency")


class AppNetworkAccessGroupUpdatePayload(BaseModel):
    enabled: bool
    group_id: UUID | None = Field(
        validation_alias=AliasChoices("group_id", "groupId", "policy_id", "policyId"),
    )
    access_points: list[NetworkAccessPoint] = Field(
        max_length=4,
        validation_alias=AliasChoices("access_points", "accessPoints"),
    )
    expected_version: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_enabled_configuration(self) -> Self:
        if len(set(self.access_points)) != len(self.access_points):
            raise ValueError("access_points must not contain duplicates")
        if self.enabled and self.group_id is None:
            raise ValueError("group_id is required when network access control is enabled")
        if self.enabled and not self.access_points:
            raise ValueError("access_points must not be empty when network access control is enabled")
        return self


class NetworkAccessGroupAppResponse(ResponseModel):
    id: str
    name: str
    icon: str | None = None
    icon_type: str | None = None
    icon_background: str | None = None


class NetworkAccessGroupResponse(ResponseModel):
    id: str
    tenant_id: str = Field(validation_alias=AliasChoices("tenant_id", "tenantId"))
    name: str
    description: str = ""
    allowed_cidrs: list[str] = Field(
        min_length=1,
        max_length=100,
        validation_alias=AliasChoices("allowed_cidrs", "allowedCidrs"),
    )
    version: int = Field(ge=1)
    used_by_count: int = Field(ge=0, validation_alias=AliasChoices("used_by_count", "usedByCount"))
    app_ids: list[str] = Field(
        validation_alias=AliasChoices("app_ids", "appIds", "used_by_app_ids", "usedByAppIds"),
    )
    apps: list[NetworkAccessGroupAppResponse]
    updated_by_account_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("updated_by_account_id", "updatedByAccountId"),
    )
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class NetworkAccessGroupListResponse(ResponseModel):
    tenant_id: str = Field(validation_alias=AliasChoices("tenant_id", "tenantId"))
    entitled: bool
    groups: list[NetworkAccessGroupResponse]


class NetworkAccessGroupMutationResponse(ResponseModel):
    group: NetworkAccessGroupResponse


class NetworkAccessGroupDeleteResponse(ResponseModel):
    deleted: bool


class AppNetworkAccessGroupBindingResponse(ResponseModel):
    id: str
    tenant_id: str = Field(validation_alias=AliasChoices("tenant_id", "tenantId"))
    app_id: str = Field(validation_alias=AliasChoices("app_id", "appId"))
    enabled: bool
    group_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("group_id", "groupId", "policy_id", "policyId"),
    )
    access_points: list[NetworkAccessPoint] = Field(
        max_length=4,
        validation_alias=AliasChoices("access_points", "accessPoints"),
    )
    version: int = Field(ge=1)
    updated_by_account_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("updated_by_account_id", "updatedByAccountId"),
    )
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))

    @model_validator(mode="after")
    def validate_enabled_configuration(self) -> Self:
        if len(set(self.access_points)) != len(self.access_points):
            raise ValueError("access_points must not contain duplicates")
        if self.enabled and self.group_id is None:
            raise ValueError("group_id is required when network access control is enabled")
        if self.enabled and not self.access_points:
            raise ValueError("access_points must not be empty when network access control is enabled")
        return self


class AppNetworkAccessGroupResponse(ResponseModel):
    tenant_id: str = Field(validation_alias=AliasChoices("tenant_id", "tenantId"))
    app_id: str = Field(validation_alias=AliasChoices("app_id", "appId"))
    entitled: bool
    available_access_points: list[NetworkAccessPoint]
    binding: AppNetworkAccessGroupBindingResponse | None


class AppNetworkAccessGroupMutationResponse(ResponseModel):
    binding: AppNetworkAccessGroupBindingResponse
    available_access_points: list[NetworkAccessPoint]


register_schema_models(
    console_ns,
    NetworkAccessGroupCreatePayload,
    NetworkAccessGroupUpdatePayload,
    AppNetworkAccessGroupUpdatePayload,
)
register_response_schema_models(
    console_ns,
    NetworkAccessGroupAppResponse,
    NetworkAccessGroupResponse,
    NetworkAccessGroupListResponse,
    NetworkAccessGroupMutationResponse,
    NetworkAccessGroupDeleteResponse,
    AppNetworkAccessGroupBindingResponse,
    AppNetworkAccessGroupResponse,
    AppNetworkAccessGroupMutationResponse,
)


def _available_access_points(app_model: App) -> list[NetworkAccessPoint]:
    app_mode = app_model.mode if isinstance(app_model.mode, AppMode) else AppMode.value_of(str(app_model.mode))
    available = _ACCESS_POINTS_BY_APP_MODE.get(app_mode)
    if available is None:
        raise BadRequest(f"Network access control is not supported for app mode '{app_mode.value}'.")
    return list(available)


def _validate_app_access_points(
    requested: list[NetworkAccessPoint],
    available: list[NetworkAccessPoint],
) -> None:
    unsupported = sorted(set(requested).difference(available))
    if unsupported:
        raise BadRequest(f"Unsupported access points for this app: {', '.join(unsupported)}.")


def _effective_entitlement(tenant_id: str, upstream_entitled: object) -> bool:
    return bool(upstream_entitled) and is_cloud_edition_billing_paid_plan(tenant_id)


def _normalize_app_binding_defaults(payload: dict) -> None:
    """Materialize ProtoJSON defaults so the Console response stays stable."""

    payload.setdefault("binding", None)
    binding = payload.get("binding")
    if not isinstance(binding, dict):
        return
    binding.setdefault("enabled", False)
    if "access_points" not in binding and "accessPoints" not in binding:
        binding["access_points"] = []


def _ensure_workspace_admin_or_owner(current_user: Account) -> None:
    """Authorize management against the persisted current-workspace membership."""

    if not TenantAccountRole.is_privileged_role(current_user.current_role):
        raise Forbidden("Only workspace owners and administrators can manage network access groups.")


def _translate_upstream_error(exc: NetworkAccessGroupUpstreamError) -> Exception:
    if exc.reason == "INVALID_SECRET_KEY":
        return ServiceUnavailable("Network access group service authentication failed.")
    if exc.status_code in (400, 422):
        return BadRequest("Invalid network access group request.")
    if exc.status_code == 401:
        return ServiceUnavailable("Network access group service authentication failed.")
    if exc.status_code == 403:
        return Forbidden("Network access groups are not available for this workspace.")
    if exc.status_code == 404:
        return NotFound("Network access group was not found.")
    if exc.status_code == 409:
        message_by_reason = {
            "NETWORK_ACCESS_VERSION_CONFLICT": "The network access resource changed. Refresh it and try again.",
            "NETWORK_ACCESS_GROUP_NAME_CONFLICT": "A network access group with this name already exists.",
            "NETWORK_ACCESS_GROUP_LIMIT": "This workspace has reached the network access group limit.",
        }
        return Conflict(message_by_reason.get(exc.reason or "", "The network access resource is in conflict."))
    if exc.status_code >= 500:
        return ServiceUnavailable("Network access group service is unavailable.")
    return BadGateway("Unexpected response from the network access group service.")


def _serialize_response(response_model: type[ResponseModel], payload: dict):
    try:
        return dump_response(response_model, payload)
    except ValidationError as exc:
        raise BadGateway("Invalid response from the network access group service.") from exc


@console_ns.route("/workspaces/current/network-access-groups")
class CurrentWorkspaceNetworkAccessGroupsApi(Resource):
    @console_ns.response(
        200,
        "Workspace network access groups retrieved successfully",
        console_ns.models[NetworkAccessGroupListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        _ensure_workspace_admin_or_owner(current_user)
        try:
            payload = BillingService.list_network_access_groups(current_tenant_id, current_user.id)
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
        payload["entitled"] = _effective_entitlement(current_tenant_id, payload.get("entitled"))
        NetworkAccessGroupService.enrich_app_references(payload, current_tenant_id)
        return _serialize_response(NetworkAccessGroupListResponse, payload)

    @console_ns.expect(console_ns.models[NetworkAccessGroupCreatePayload.__name__])
    @console_ns.response(
        201,
        "Workspace network access group created successfully",
        console_ns.models[NetworkAccessGroupMutationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_paid_plan_required
    @with_current_user
    @with_current_tenant_id
    @model_validate(NetworkAccessGroupCreatePayload)
    def post(
        self,
        req_data: NetworkAccessGroupCreatePayload,
        current_tenant_id: str,
        current_user: Account,
    ):
        _ensure_workspace_admin_or_owner(current_user)
        try:
            payload = BillingService.create_network_access_group(
                current_tenant_id,
                name=req_data.name,
                description=req_data.description,
                allowed_cidrs=req_data.allowed_cidrs,
                actor_account_id=current_user.id,
            )
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
        NetworkAccessGroupService.enrich_app_references(payload, current_tenant_id)
        return _serialize_response(NetworkAccessGroupMutationResponse, payload), 201


@console_ns.route("/workspaces/current/network-access-groups/<uuid:group_id>")
class CurrentWorkspaceNetworkAccessGroupApi(Resource):
    @console_ns.response(
        200,
        "Workspace network access group retrieved successfully",
        console_ns.models[NetworkAccessGroupMutationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account, group_id: UUID):
        _ensure_workspace_admin_or_owner(current_user)
        try:
            payload = BillingService.get_network_access_group(current_tenant_id, str(group_id), current_user.id)
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
        NetworkAccessGroupService.enrich_app_references(payload, current_tenant_id)
        return _serialize_response(NetworkAccessGroupMutationResponse, payload)

    @console_ns.expect(console_ns.models[NetworkAccessGroupUpdatePayload.__name__])
    @console_ns.response(
        200,
        "Workspace network access group updated successfully",
        console_ns.models[NetworkAccessGroupMutationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_paid_plan_required
    @with_current_user
    @with_current_tenant_id
    @model_validate(NetworkAccessGroupUpdatePayload)
    def put(
        self,
        req_data: NetworkAccessGroupUpdatePayload,
        current_tenant_id: str,
        current_user: Account,
        group_id: UUID,
    ):
        _ensure_workspace_admin_or_owner(current_user)
        try:
            payload = BillingService.update_network_access_group(
                current_tenant_id,
                str(group_id),
                name=req_data.name,
                description=req_data.description,
                allowed_cidrs=req_data.allowed_cidrs,
                expected_version=req_data.expected_version,
                actor_account_id=current_user.id,
            )
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
        NetworkAccessGroupService.enrich_app_references(payload, current_tenant_id)
        return _serialize_response(NetworkAccessGroupMutationResponse, payload)

    @console_ns.doc(params=query_params_from_model(NetworkAccessGroupDeleteQuery))
    @console_ns.response(
        200,
        "Workspace network access group deleted successfully",
        console_ns.models[NetworkAccessGroupDeleteResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_paid_plan_required
    @with_current_user
    @with_current_tenant_id
    @model_validate(NetworkAccessGroupDeleteQuery)
    def delete(
        self,
        req_data: NetworkAccessGroupDeleteQuery,
        current_tenant_id: str,
        current_user: Account,
        group_id: UUID,
    ):
        _ensure_workspace_admin_or_owner(current_user)
        try:
            payload = BillingService.delete_network_access_group(
                current_tenant_id,
                str(group_id),
                expected_version=req_data.expected_version,
                actor_account_id=current_user.id,
            )
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
        return _serialize_response(NetworkAccessGroupDeleteResponse, payload)


@console_ns.route("/apps/<uuid:app_id>/network-access-group")
class AppNetworkAccessGroupApi(Resource):
    @console_ns.response(
        200,
        "App network access group binding retrieved successfully",
        console_ns.models[AppNetworkAccessGroupResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @with_current_user
    @with_current_tenant_id
    @get_app_model
    def get(self, current_tenant_id: str, current_user: Account, app_model: App):
        _ensure_workspace_admin_or_owner(current_user)
        available_access_points = _available_access_points(app_model)
        try:
            payload = BillingService.get_app_network_access_group(
                current_tenant_id,
                str(app_model.id),
                current_user.id,
            )
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
        _normalize_app_binding_defaults(payload)
        payload["entitled"] = _effective_entitlement(current_tenant_id, payload.get("entitled"))
        payload["available_access_points"] = available_access_points
        return _serialize_response(AppNetworkAccessGroupResponse, payload)

    @console_ns.expect(console_ns.models[AppNetworkAccessGroupUpdatePayload.__name__])
    @console_ns.response(
        200,
        "App network access group binding updated successfully",
        console_ns.models[AppNetworkAccessGroupMutationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_paid_plan_required
    @with_current_user
    @with_current_tenant_id
    @get_app_model
    @model_validate(AppNetworkAccessGroupUpdatePayload)
    def put(
        self,
        req_data: AppNetworkAccessGroupUpdatePayload,
        current_tenant_id: str,
        current_user: Account,
        app_model: App,
    ):
        _ensure_workspace_admin_or_owner(current_user)
        available_access_points = _available_access_points(app_model)
        _validate_app_access_points(req_data.access_points, available_access_points)
        try:
            payload = BillingService.update_app_network_access_group(
                current_tenant_id,
                str(app_model.id),
                enabled=req_data.enabled,
                group_id=str(req_data.group_id) if req_data.group_id is not None else None,
                access_points=list(req_data.access_points),
                expected_version=req_data.expected_version,
                actor_account_id=current_user.id,
            )
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
        _normalize_app_binding_defaults(payload)
        payload["available_access_points"] = available_access_points
        return _serialize_response(AppNetworkAccessGroupMutationResponse, payload)
