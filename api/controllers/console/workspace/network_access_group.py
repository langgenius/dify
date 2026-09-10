from datetime import datetime
from typing import Any, Self
from uuid import UUID

from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, ValidationError, model_validator
from werkzeug.exceptions import BadGateway, BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import cloud_edition_billing_paid_plan_required, model_validate
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from services.network_access_group_service import (
    NetworkAccessGroupAccessDeniedError,
    NetworkAccessGroupAppNotFoundError,
    NetworkAccessGroupEntitlementUnavailableError,
    NetworkAccessGroupError,
    NetworkAccessGroupUnsupportedAccessPointsError,
    NetworkAccessGroupUnsupportedAppModeError,
    NetworkAccessGroupUpstreamError,
    NetworkAccessPoint,
)


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


def _translate_service_error(exc: NetworkAccessGroupError) -> Exception:
    if isinstance(exc, NetworkAccessGroupUpstreamError):
        return _translate_upstream_error(exc)
    if isinstance(exc, NetworkAccessGroupAccessDeniedError):
        return Forbidden("Only workspace owners and administrators can manage network access groups.")
    if isinstance(exc, NetworkAccessGroupEntitlementUnavailableError):
        return ServiceUnavailable("Billing entitlement is temporarily unavailable.")
    if isinstance(exc, NetworkAccessGroupAppNotFoundError):
        return AppNotFoundError()
    if isinstance(exc, NetworkAccessGroupUnsupportedAppModeError):
        return BadRequest(f"Network access control is not supported for app mode '{exc.app_mode}'.")
    if isinstance(exc, NetworkAccessGroupUnsupportedAccessPointsError):
        return BadRequest(f"Unsupported access points for this app: {', '.join(exc.access_points)}.")
    raise TypeError(f"Unsupported network access group error: {type(exc).__name__}")


def _serialize_response(response_model: type[ResponseModel], payload: dict[str, Any]) -> dict[str, Any]:
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
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    def get(self, request_context: RequestContext) -> dict[str, Any]:
        try:
            payload = application_services().network_access_groups.list_groups(request_context)
        except NetworkAccessGroupError as exc:
            raise _translate_service_error(exc) from exc
        return _serialize_response(NetworkAccessGroupListResponse, payload)

    @console_ns.expect(console_ns.models[NetworkAccessGroupCreatePayload.__name__])
    @console_ns.response(
        201,
        "Workspace network access group created successfully",
        console_ns.models[NetworkAccessGroupMutationResponse.__name__],
    )
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    @cloud_edition_billing_paid_plan_required
    @model_validate(NetworkAccessGroupCreatePayload)
    def post(
        self,
        req_data: NetworkAccessGroupCreatePayload,
        request_context: RequestContext,
    ) -> tuple[dict[str, Any], int]:
        try:
            payload = application_services().network_access_groups.create_group(
                request_context,
                name=req_data.name,
                description=req_data.description,
                allowed_cidrs=req_data.allowed_cidrs,
            )
        except NetworkAccessGroupError as exc:
            raise _translate_service_error(exc) from exc
        return _serialize_response(NetworkAccessGroupMutationResponse, payload), 201


@console_ns.route("/workspaces/current/network-access-groups/<uuid:group_id>")
class CurrentWorkspaceNetworkAccessGroupApi(Resource):
    @console_ns.response(
        200,
        "Workspace network access group retrieved successfully",
        console_ns.models[NetworkAccessGroupMutationResponse.__name__],
    )
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    def get(self, request_context: RequestContext, group_id: UUID) -> dict[str, Any]:
        try:
            payload = application_services().network_access_groups.get_group(
                request_context,
                group_id=str(group_id),
            )
        except NetworkAccessGroupError as exc:
            raise _translate_service_error(exc) from exc
        return _serialize_response(NetworkAccessGroupMutationResponse, payload)

    @console_ns.expect(console_ns.models[NetworkAccessGroupUpdatePayload.__name__])
    @console_ns.response(
        200,
        "Workspace network access group updated successfully",
        console_ns.models[NetworkAccessGroupMutationResponse.__name__],
    )
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    @cloud_edition_billing_paid_plan_required
    @model_validate(NetworkAccessGroupUpdatePayload)
    def put(
        self,
        req_data: NetworkAccessGroupUpdatePayload,
        request_context: RequestContext,
        group_id: UUID,
    ) -> dict[str, Any]:
        try:
            payload = application_services().network_access_groups.update_group(
                request_context,
                group_id=str(group_id),
                name=req_data.name,
                description=req_data.description,
                allowed_cidrs=req_data.allowed_cidrs,
                expected_version=req_data.expected_version,
            )
        except NetworkAccessGroupError as exc:
            raise _translate_service_error(exc) from exc
        return _serialize_response(NetworkAccessGroupMutationResponse, payload)

    @console_ns.doc(params=query_params_from_model(NetworkAccessGroupDeleteQuery))
    @console_ns.response(
        200,
        "Workspace network access group deleted successfully",
        console_ns.models[NetworkAccessGroupDeleteResponse.__name__],
    )
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    @cloud_edition_billing_paid_plan_required
    @model_validate(NetworkAccessGroupDeleteQuery)
    def delete(
        self,
        req_data: NetworkAccessGroupDeleteQuery,
        request_context: RequestContext,
        group_id: UUID,
    ) -> dict[str, Any]:
        try:
            payload = application_services().network_access_groups.delete_group(
                request_context,
                group_id=str(group_id),
                expected_version=req_data.expected_version,
            )
        except NetworkAccessGroupError as exc:
            raise _translate_service_error(exc) from exc
        return _serialize_response(NetworkAccessGroupDeleteResponse, payload)


@console_ns.route("/apps/<uuid:app_id>/network-access-group")
class AppNetworkAccessGroupApi(Resource):
    @console_ns.response(
        200,
        "App network access group binding retrieved successfully",
        console_ns.models[AppNetworkAccessGroupResponse.__name__],
    )
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    def get(self, request_context: RequestContext, app_id: UUID) -> dict[str, Any]:
        try:
            payload = application_services().network_access_groups.get_app_binding(
                request_context,
                app_id=str(app_id),
            )
        except NetworkAccessGroupError as exc:
            raise _translate_service_error(exc) from exc
        return _serialize_response(AppNetworkAccessGroupResponse, payload)

    @console_ns.expect(console_ns.models[AppNetworkAccessGroupUpdatePayload.__name__])
    @console_ns.response(
        200,
        "App network access group binding updated successfully",
        console_ns.models[AppNetworkAccessGroupMutationResponse.__name__],
    )
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    @cloud_edition_billing_paid_plan_required
    @model_validate(AppNetworkAccessGroupUpdatePayload)
    def put(
        self,
        req_data: AppNetworkAccessGroupUpdatePayload,
        request_context: RequestContext,
        app_id: UUID,
    ) -> dict[str, Any]:
        try:
            payload = application_services().network_access_groups.update_app_binding(
                request_context,
                app_id=str(app_id),
                enabled=req_data.enabled,
                group_id=str(req_data.group_id) if req_data.group_id is not None else None,
                access_points=list(req_data.access_points),
                expected_version=req_data.expected_version,
            )
        except NetworkAccessGroupError as exc:
            raise _translate_service_error(exc) from exc
        return _serialize_response(AppNetworkAccessGroupMutationResponse, payload)
