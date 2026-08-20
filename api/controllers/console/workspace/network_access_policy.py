from datetime import datetime
from typing import Literal

from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, ValidationError
from werkzeug.exceptions import BadGateway, BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    model_validate,
    only_edition_cloud,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from models import Account
from services.billing_service import BillingService, NetworkAccessPolicyUpstreamError

NetworkAccessPolicyScope = Literal["service_api", "mcp", "workflow_webhook", "plugin_trigger"]
NetworkAccessPolicyMode = Literal["disabled", "shadow", "enforce"]


class NetworkAccessPolicyPayload(BaseModel):
    scope: NetworkAccessPolicyScope
    mode: NetworkAccessPolicyMode
    allowed_cidrs: list[str] = Field(max_length=100)
    expected_version: int = Field(ge=0)


class NetworkAccessPolicyResponse(ResponseModel):
    scope: NetworkAccessPolicyScope
    mode: NetworkAccessPolicyMode
    allowed_cidrs: list[str] = Field(validation_alias=AliasChoices("allowed_cidrs", "allowedCidrs"))
    version: int = Field(ge=0)
    updated_by_account_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("updated_by_account_id", "updatedByAccountId"),
    )
    created_at: datetime | None = Field(default=None, validation_alias=AliasChoices("created_at", "createdAt"))
    updated_at: datetime | None = Field(default=None, validation_alias=AliasChoices("updated_at", "updatedAt"))


class NetworkAccessPolicyListResponse(ResponseModel):
    tenant_id: str = Field(validation_alias=AliasChoices("tenant_id", "tenantId"))
    entitled: bool
    policies: list[NetworkAccessPolicyResponse]


class NetworkAccessPolicyUpdateResponse(ResponseModel):
    policy: NetworkAccessPolicyResponse


register_schema_models(console_ns, NetworkAccessPolicyPayload)
register_response_schema_models(
    console_ns,
    NetworkAccessPolicyResponse,
    NetworkAccessPolicyListResponse,
    NetworkAccessPolicyUpdateResponse,
)


def _ensure_workspace_admin_or_owner(current_user: Account) -> None:
    """Authorize against persisted workspace membership, including when RBAC is enabled."""

    try:
        BillingService.is_tenant_owner_or_admin(current_user, session=db.session())
    except ValueError as exc:
        raise Forbidden("Only workspace owners and administrators can manage network access policies.") from exc


def _translate_upstream_error(exc: NetworkAccessPolicyUpstreamError) -> Exception:
    if exc.status_code in (400, 422):
        return BadRequest("Invalid network access policy.")
    if exc.status_code in (401, 403):
        return Forbidden("Network access policy is not available for this workspace.")
    if exc.status_code == 404:
        return NotFound("Workspace network access policy was not found.")
    if exc.status_code == 409:
        return Conflict("The network access policy changed. Refresh it and try again.")
    if exc.status_code >= 500:
        return ServiceUnavailable("Network access policy service is unavailable.")
    return BadGateway("Unexpected response from the network access policy service.")


def _serialize_response(response_model: type[ResponseModel], payload: dict):
    try:
        return dump_response(response_model, payload)
    except ValidationError as exc:
        raise BadGateway("Invalid response from the network access policy service.") from exc


@console_ns.route("/workspaces/current/network-access-policy")
class CurrentWorkspaceNetworkAccessPolicyApi(Resource):
    @console_ns.response(
        200,
        "Workspace network access policies retrieved successfully",
        console_ns.models[NetworkAccessPolicyListResponse.__name__],
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
            payload = BillingService.get_network_access_policies(current_tenant_id, current_user.id)
        except NetworkAccessPolicyUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
        return _serialize_response(NetworkAccessPolicyListResponse, payload)

    @console_ns.expect(console_ns.models[NetworkAccessPolicyPayload.__name__])
    @console_ns.response(
        200,
        "Workspace network access policy updated successfully",
        console_ns.models[NetworkAccessPolicyUpdateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @with_current_user
    @with_current_tenant_id
    @model_validate(NetworkAccessPolicyPayload)
    def put(
        self,
        req_data: NetworkAccessPolicyPayload,
        current_tenant_id: str,
        current_user: Account,
    ):
        _ensure_workspace_admin_or_owner(current_user)
        try:
            payload = BillingService.update_network_access_policy(
                current_tenant_id,
                req_data.scope,
                mode=req_data.mode,
                allowed_cidrs=req_data.allowed_cidrs,
                expected_version=req_data.expected_version,
                actor_account_id=current_user.id,
            )
        except NetworkAccessPolicyUpstreamError as exc:
            raise _translate_upstream_error(exc) from exc
        return _serialize_response(NetworkAccessPolicyUpdateResponse, payload)
