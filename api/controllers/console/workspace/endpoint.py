"""Console workspace endpoint controllers.

This module exposes workspace-scoped plugin endpoint management APIs. The
canonical write routes follow resource-oriented paths, while the historical
verb-based aliases stay available as deprecated resources so OpenAPI metadata
marks only the legacy paths as deprecated.
"""

from datetime import datetime
from enum import StrEnum
from http import HTTPStatus
from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.fields import SuccessResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    is_admin_or_owner_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user_id,
)
from core.entities.parameter_entities import (
    AppSelectorScope,
    ModelSelectorScope,
    ToolSelectorScope,
)
from core.entities.provider_entities import ProviderConfigType
from core.plugin.impl.exc import PluginPermissionDeniedError
from fields.base import ResponseModel
from libs.login import login_required
from services.plugin.endpoint_service import EndpointService


class EndpointCreatePayload(BaseModel):
    plugin_unique_identifier: str
    settings: dict[str, Any]
    name: str = Field(min_length=1)


class EndpointIdPayload(BaseModel):
    endpoint_id: str


class EndpointSettingsPayload(BaseModel):
    settings: dict[str, Any]
    name: str = Field(min_length=1)


class EndpointUpdatePayload(EndpointSettingsPayload):
    pass


class LegacyEndpointUpdatePayload(EndpointIdPayload, EndpointSettingsPayload):
    pass


class EndpointListQuery(BaseModel):
    page: int = Field(ge=1)
    page_size: int = Field(gt=0)


class EndpointListForPluginQuery(EndpointListQuery):
    plugin_id: str


class EndpointProviderConfigScope(StrEnum):
    ALL = AppSelectorScope.ALL.value
    CHAT = AppSelectorScope.CHAT.value
    WORKFLOW = AppSelectorScope.WORKFLOW.value
    COMPLETION = AppSelectorScope.COMPLETION.value
    LLM = ModelSelectorScope.LLM.value
    TEXT_EMBEDDING = ModelSelectorScope.TEXT_EMBEDDING.value
    RERANK = ModelSelectorScope.RERANK.value
    TTS = ModelSelectorScope.TTS.value
    SPEECH2TEXT = ModelSelectorScope.SPEECH2TEXT.value
    MODERATION = ModelSelectorScope.MODERATION.value
    VISION = ModelSelectorScope.VISION.value
    CUSTOM = ToolSelectorScope.CUSTOM.value
    BUILTIN = ToolSelectorScope.BUILTIN.value


class EndpointProviderConfigI18nResponse(ResponseModel):
    en_US: str
    zh_Hans: str | None = None
    pt_BR: str | None = None
    ja_JP: str | None = None


class EndpointProviderConfigOptionResponse(ResponseModel):
    value: str
    label: EndpointProviderConfigI18nResponse


class EndpointProviderConfigResponse(ResponseModel):
    type: ProviderConfigType
    name: str
    scope: EndpointProviderConfigScope | None = None
    required: bool = False
    default: int | str | float | bool | None = None
    options: list[EndpointProviderConfigOptionResponse] | None = None
    multiple: bool = False
    label: EndpointProviderConfigI18nResponse | None = None
    help: EndpointProviderConfigI18nResponse | None = None
    url: str | None = None
    placeholder: EndpointProviderConfigI18nResponse | None = None


class EndpointDeclarationResponse(ResponseModel):
    path: str
    method: str
    hidden: bool = False


class EndpointProviderDeclarationResponse(ResponseModel):
    settings: list[EndpointProviderConfigResponse] = Field(default_factory=list)
    endpoints: list[EndpointDeclarationResponse] | None = Field(default_factory=list)


class EndpointListItemResponse(ResponseModel):
    id: str
    created_at: datetime
    updated_at: datetime
    tenant_id: str
    plugin_id: str
    settings: dict[str, Any]
    expired_at: datetime
    declaration: EndpointProviderDeclarationResponse = Field(default_factory=EndpointProviderDeclarationResponse)
    name: str
    enabled: bool
    url: str
    hook_id: str


class EndpointListResponse(ResponseModel):
    endpoints: list[EndpointListItemResponse] = Field(description="Endpoint information")


register_schema_models(
    console_ns,
    EndpointCreatePayload,
    EndpointIdPayload,
    EndpointSettingsPayload,
    EndpointUpdatePayload,
    LegacyEndpointUpdatePayload,
    EndpointListQuery,
    EndpointListForPluginQuery,
)
register_response_schema_models(
    console_ns,
    SuccessResponse,
    EndpointProviderConfigOptionResponse,
    EndpointProviderConfigResponse,
    EndpointDeclarationResponse,
    EndpointProviderDeclarationResponse,
    EndpointListItemResponse,
    EndpointListResponse,
)


def _create_endpoint(tenant_id: str, user_id: str) -> bool:
    """Create a plugin endpoint for the injected workspace and user."""
    args = EndpointCreatePayload.model_validate(console_ns.payload)

    try:
        return EndpointService.create_endpoint(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_unique_identifier=args.plugin_unique_identifier,
            name=args.name,
            settings=args.settings,
        )
    except PluginPermissionDeniedError as e:
        raise ValueError(e.description) from e


def _update_endpoint(tenant_id: str, user_id: str, endpoint_id: str) -> bool:
    """Update a plugin endpoint identified by the canonical path parameter."""
    args = EndpointUpdatePayload.model_validate(console_ns.payload)

    return EndpointService.update_endpoint(
        tenant_id=tenant_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        name=args.name,
        settings=args.settings,
    )


def _legacy_update_endpoint(tenant_id: str, user_id: str) -> bool:
    args = LegacyEndpointUpdatePayload.model_validate(console_ns.payload)
    return EndpointService.update_endpoint(
        tenant_id=tenant_id,
        user_id=user_id,
        endpoint_id=args.endpoint_id,
        name=args.name,
        settings=args.settings,
    )


def _delete_endpoint(tenant_id: str, user_id: str, endpoint_id: str) -> bool:
    """Delete a plugin endpoint identified by the canonical path parameter."""
    return EndpointService.delete_endpoint(
        tenant_id=tenant_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
    )


def _delete_endpoint_from_payload(tenant_id: str, user_id: str) -> bool:
    args = EndpointIdPayload.model_validate(console_ns.payload)
    return _delete_endpoint(tenant_id=tenant_id, user_id=user_id, endpoint_id=args.endpoint_id)


def _set_endpoint_enabled(tenant_id: str, user_id: str, *, enabled: bool) -> bool:
    args = EndpointIdPayload.model_validate(console_ns.payload)
    action = EndpointService.enable_endpoint if enabled else EndpointService.disable_endpoint
    return action(tenant_id=tenant_id, user_id=user_id, endpoint_id=args.endpoint_id)


@console_ns.route("/workspaces/current/endpoints")
class EndpointCollectionApi(Resource):
    """Canonical collection resource for endpoint creation."""

    @console_ns.doc("create_endpoint")
    @console_ns.doc(description="Create a new plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Endpoint created successfully",
        console_ns.models[SuccessResponse.__name__],
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def post(self, tenant_id: str, user_id: str):
        return SuccessResponse(success=_create_endpoint(tenant_id=tenant_id, user_id=user_id)).model_dump(mode="json")


@console_ns.route("/workspaces/current/endpoints/create")
class DeprecatedEndpointCreateApi(Resource):
    """Deprecated verb-based alias for endpoint creation."""

    @console_ns.doc("create_endpoint_deprecated")
    @console_ns.doc(deprecated=True)
    @console_ns.doc(
        description=(
            "Deprecated legacy alias for creating a plugin endpoint. Use POST /workspaces/current/endpoints instead."
        )
    )
    @console_ns.expect(console_ns.models[EndpointCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Endpoint created successfully",
        console_ns.models[SuccessResponse.__name__],
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def post(self, tenant_id: str, user_id: str):
        return SuccessResponse(success=_create_endpoint(tenant_id=tenant_id, user_id=user_id)).model_dump(mode="json")


@console_ns.route("/workspaces/current/endpoints/list")
class EndpointListApi(Resource):
    @console_ns.doc("list_endpoints")
    @console_ns.doc(description="List plugin endpoints with pagination")
    @console_ns.doc(params=query_params_from_model(EndpointListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "Success",
        console_ns.models[EndpointListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def get(self, tenant_id: str, user_id: str):
        args = EndpointListQuery.model_validate(request.args.to_dict(flat=True))

        endpoints = EndpointService.list_endpoints(
            tenant_id=tenant_id,
            user_id=user_id,
            page=args.page,
            page_size=args.page_size,
        )

        return EndpointListResponse(endpoints=endpoints).model_dump(mode="json")


@console_ns.route("/workspaces/current/endpoints/list/plugin")
class EndpointListForSinglePluginApi(Resource):
    @console_ns.doc("list_plugin_endpoints")
    @console_ns.doc(description="List endpoints for a specific plugin")
    @console_ns.doc(params=query_params_from_model(EndpointListForPluginQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "Success",
        console_ns.models[EndpointListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def get(self, tenant_id: str, user_id: str):
        args = EndpointListForPluginQuery.model_validate(request.args.to_dict(flat=True))

        endpoints = EndpointService.list_endpoints_for_single_plugin(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_id=args.plugin_id,
            page=args.page,
            page_size=args.page_size,
        )

        return EndpointListResponse(endpoints=endpoints).model_dump(mode="json")


@console_ns.route("/workspaces/current/endpoints/<string:id>")
class EndpointItemApi(Resource):
    """Canonical item resource for endpoint updates and deletion."""

    @console_ns.doc("delete_endpoint")
    @console_ns.doc(description="Delete a plugin endpoint")
    @console_ns.doc(params={"id": {"description": "Endpoint ID", "type": "string", "required": True}})
    @console_ns.response(
        HTTPStatus.OK,
        "Endpoint deleted successfully",
        console_ns.models[SuccessResponse.__name__],
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def delete(self, tenant_id: str, user_id: str, id: str):
        return SuccessResponse(
            success=_delete_endpoint(tenant_id=tenant_id, user_id=user_id, endpoint_id=id)
        ).model_dump(mode="json")

    @console_ns.doc("update_endpoint")
    @console_ns.doc(description="Update a plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointUpdatePayload.__name__])
    @console_ns.doc(params={"id": {"description": "Endpoint ID", "type": "string", "required": True}})
    @console_ns.response(
        HTTPStatus.OK,
        "Endpoint updated successfully",
        console_ns.models[SuccessResponse.__name__],
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def patch(self, tenant_id: str, user_id: str, id: str):
        return SuccessResponse(
            success=_update_endpoint(tenant_id=tenant_id, user_id=user_id, endpoint_id=id)
        ).model_dump(mode="json")


@console_ns.route("/workspaces/current/endpoints/delete")
class DeprecatedEndpointDeleteApi(Resource):
    """Deprecated verb-based alias for endpoint deletion."""

    @console_ns.doc("delete_endpoint_deprecated")
    @console_ns.doc(deprecated=True)
    @console_ns.doc(
        description=(
            "Deprecated legacy alias for deleting a plugin endpoint. "
            "Use DELETE /workspaces/current/endpoints/{id} instead."
        )
    )
    @console_ns.expect(console_ns.models[EndpointIdPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Endpoint deleted successfully",
        console_ns.models[SuccessResponse.__name__],
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def post(self, tenant_id: str, user_id: str):
        return SuccessResponse(success=_delete_endpoint_from_payload(tenant_id=tenant_id, user_id=user_id)).model_dump(
            mode="json"
        )


@console_ns.route("/workspaces/current/endpoints/update")
class DeprecatedEndpointUpdateApi(Resource):
    """Deprecated verb-based alias for endpoint updates."""

    @console_ns.doc("update_endpoint_deprecated")
    @console_ns.doc(deprecated=True)
    @console_ns.doc(
        description=(
            "Deprecated legacy alias for updating a plugin endpoint. "
            "Use PATCH /workspaces/current/endpoints/{id} instead."
        )
    )
    @console_ns.expect(console_ns.models[LegacyEndpointUpdatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Endpoint updated successfully",
        console_ns.models[SuccessResponse.__name__],
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def post(self, tenant_id: str, user_id: str):
        return SuccessResponse(success=_legacy_update_endpoint(tenant_id=tenant_id, user_id=user_id)).model_dump(
            mode="json"
        )


@console_ns.route("/workspaces/current/endpoints/enable")
class EndpointEnableApi(Resource):
    @console_ns.doc("enable_endpoint")
    @console_ns.doc(description="Enable a plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointIdPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Endpoint enabled successfully",
        console_ns.models[SuccessResponse.__name__],
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def post(self, tenant_id: str, user_id: str):
        return SuccessResponse(
            success=_set_endpoint_enabled(tenant_id=tenant_id, user_id=user_id, enabled=True)
        ).model_dump(mode="json")


@console_ns.route("/workspaces/current/endpoints/disable")
class EndpointDisableApi(Resource):
    @console_ns.doc("disable_endpoint")
    @console_ns.doc(description="Disable a plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointIdPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Endpoint disabled successfully",
        console_ns.models[SuccessResponse.__name__],
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_MODEL_CONFIG, resource_required=False)
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def post(self, tenant_id: str, user_id: str):
        return SuccessResponse(
            success=_set_endpoint_enabled(tenant_id=tenant_id, user_id=user_id, enabled=False)
        ).model_dump(mode="json")
