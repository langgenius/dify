from datetime import datetime
from typing import Literal
from uuid import UUID

from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, ValidationError
from werkzeug.exceptions import BadGateway, BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    account_initialization_required,
    model_validate,
    only_edition_cloud,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from models import Account, App, TenantAccountRole
from services.billing_service import BillingService, NetworkAccessGroupUpstreamError

NetworkAccessGroupMode = Literal["disabled", "shadow", "enforce"]


class NetworkAccessGroupCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    mode: NetworkAccessGroupMode
    allowed_cidrs: list[str] = Field(max_length=100)


class NetworkAccessGroupUpdatePayload(NetworkAccessGroupCreatePayload):
    expected_version: int = Field(ge=1)


class NetworkAccessGroupDeleteQuery(BaseModel):
    expected_version: int = Field(ge=1, description="Current group version used for optimistic concurrency")


class AppNetworkAccessGroupUpdatePayload(BaseModel):
    group_id: UUID | None
    expected_version: int = Field(ge=0)


class NetworkAccessGroupResponse(ResponseModel):
    id: str
    tenant_id: str = Field(validation_alias=AliasChoices("tenant_id", "tenantId"))
    name: str
    description: str = ""
    mode: NetworkAccessGroupMode
    allowed_cidrs: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("allowed_cidrs", "allowedCidrs"),
    )
    version: int = Field(ge=1)
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
    group_id: str | None = Field(default=None, validation_alias=AliasChoices("group_id", "groupId"))
    version: int = Field(ge=1)
    updated_by_account_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("updated_by_account_id", "updatedByAccountId"),
    )
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class AppNetworkAccessGroupResponse(ResponseModel):
    tenant_id: str = Field(validation_alias=AliasChoices("tenant_id", "tenantId"))
    app_id: str = Field(validation_alias=AliasChoices("app_id", "appId"))
    entitled: bool
    binding: AppNetworkAccessGroupBindingResponse | None


class AppNetworkAccessGroupMutationResponse(ResponseModel):
    binding: AppNetworkAccessGroupBindingResponse


register_schema_models(
    console_ns,
    NetworkAccessGroupCreatePayload,
    NetworkAccessGroupUpdatePayload,
    AppNetworkAccessGroupUpdatePayload,
)
register_response_schema_models(
    console_ns,
    NetworkAccessGroupResponse,
    NetworkAccessGroupListResponse,
    NetworkAccessGroupMutationResponse,
    NetworkAccessGroupDeleteResponse,
    AppNetworkAccessGroupBindingResponse,
    AppNetworkAccessGroupResponse,
    AppNetworkAccessGroupMutationResponse,
)


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
            "NETWORK_ACCESS_GROUP_BOUND": ("Unassign this network access group from every app before deleting it."),
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
                mode=req_data.mode,
                allowed_cidrs=req_data.allowed_cidrs,
                actor_account_id=current_user.id,
            )
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
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
                mode=req_data.mode,
                allowed_cidrs=req_data.allowed_cidrs,
                expected_version=req_data.expected_version,
                actor_account_id=current_user.id,
            )
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
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
        try:
            payload = BillingService.get_app_network_access_group(
                current_tenant_id,
                str(app_model.id),
                current_user.id,
            )
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
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
        try:
            payload = BillingService.update_app_network_access_group(
                current_tenant_id,
                str(app_model.id),
                group_id=str(req_data.group_id) if req_data.group_id is not None else None,
                expected_version=req_data.expected_version,
                actor_account_id=current_user.id,
            )
        except NetworkAccessGroupUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
        return _serialize_response(AppNetworkAccessGroupMutationResponse, payload)
