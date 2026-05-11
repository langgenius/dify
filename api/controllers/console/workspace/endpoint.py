"""Console workspace endpoint controllers.

This module exposes workspace-scoped plugin endpoint management APIs. The
canonical write routes follow resource-oriented paths, while the historical
verb-based aliases stay available as deprecated resources so OpenAPI metadata
marks only the legacy paths as deprecated.
"""

from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, is_admin_or_owner_required, setup_required
from core.plugin.impl.exc import PluginPermissionDeniedError
from graphon.model_runtime.utils.encoders import jsonable_encoder
from libs.login import current_account_with_tenant, login_required
from services.plugin.endpoint_service import EndpointService


class EndpointCreatePayload(BaseModel):
    plugin_unique_identifier: str
    settings: dict[str, Any]
    name: str = Field(min_length=1)


class EndpointIdPayload(BaseModel):
    endpoint_id: str


class EndpointUpdatePayload(BaseModel):
    settings: dict[str, Any]
    name: str = Field(min_length=1)


class LegacyEndpointUpdatePayload(EndpointIdPayload):
    settings: dict[str, Any]
    name: str = Field(min_length=1)


class EndpointListQuery(BaseModel):
    page: int = Field(ge=1)
    page_size: int = Field(gt=0)


class EndpointListForPluginQuery(EndpointListQuery):
    plugin_id: str


class EndpointCreateResponse(BaseModel):
    success: bool = Field(description="Operation success")


class EndpointListResponse(BaseModel):
    endpoints: list[dict[str, Any]] = Field(description="Endpoint information")


class PluginEndpointListResponse(BaseModel):
    endpoints: list[dict[str, Any]] = Field(description="Endpoint information")


class EndpointDeleteResponse(BaseModel):
    success: bool = Field(description="Operation success")


class EndpointUpdateResponse(BaseModel):
    success: bool = Field(description="Operation success")


class EndpointEnableResponse(BaseModel):
    success: bool = Field(description="Operation success")


class EndpointDisableResponse(BaseModel):
    success: bool = Field(description="Operation success")


register_schema_models(
    console_ns,
    EndpointCreatePayload,
    EndpointIdPayload,
    EndpointUpdatePayload,
    LegacyEndpointUpdatePayload,
    EndpointListQuery,
    EndpointListForPluginQuery,
    EndpointCreateResponse,
    EndpointListResponse,
    PluginEndpointListResponse,
    EndpointDeleteResponse,
    EndpointUpdateResponse,
    EndpointEnableResponse,
    EndpointDisableResponse,
)


def _create_endpoint() -> dict[str, bool]:
    """Create a plugin endpoint for the current workspace."""
    user, tenant_id = current_account_with_tenant()

    args = EndpointCreatePayload.model_validate(console_ns.payload)

    try:
        return {
            "success": EndpointService.create_endpoint(
                tenant_id=tenant_id,
                user_id=user.id,
                plugin_unique_identifier=args.plugin_unique_identifier,
                name=args.name,
                settings=args.settings,
            )
        }
    except PluginPermissionDeniedError as e:
        raise ValueError(e.description) from e


def _update_endpoint(endpoint_id: str) -> dict[str, bool]:
    """Update a plugin endpoint identified by the canonical path parameter."""
    user, tenant_id = current_account_with_tenant()

    args = EndpointUpdatePayload.model_validate(console_ns.payload)

    return {
        "success": EndpointService.update_endpoint(
            tenant_id=tenant_id,
            user_id=user.id,
            endpoint_id=endpoint_id,
            name=args.name,
            settings=args.settings,
        )
    }


def _delete_endpoint(endpoint_id: str) -> dict[str, bool]:
    """Delete a plugin endpoint identified by the canonical path parameter."""
    user, tenant_id = current_account_with_tenant()

    return {
        "success": EndpointService.delete_endpoint(
            tenant_id=tenant_id,
            user_id=user.id,
            endpoint_id=endpoint_id,
        )
    }


@console_ns.route("/workspaces/current/endpoints")
class EndpointCollectionApi(Resource):
    """Canonical collection resource for endpoint creation."""

    @console_ns.doc("create_endpoint")
    @console_ns.doc(description="Create a new plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointCreatePayload.__name__])
    @console_ns.response(
        200,
        "Endpoint created successfully",
        console_ns.models[EndpointCreateResponse.__name__],
    )
    @console_ns.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        return _create_endpoint()


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
        200,
        "Endpoint created successfully",
        console_ns.models[EndpointCreateResponse.__name__],
    )
    @console_ns.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        return _create_endpoint()


@console_ns.route("/workspaces/current/endpoints/list")
class EndpointListApi(Resource):
    @console_ns.doc("list_endpoints")
    @console_ns.doc(description="List plugin endpoints with pagination")
    @console_ns.expect(console_ns.models[EndpointListQuery.__name__])
    @console_ns.response(
        200,
        "Success",
        console_ns.models[EndpointListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        args = EndpointListQuery.model_validate(request.args.to_dict(flat=True))

        page = args.page
        page_size = args.page_size

        return jsonable_encoder(
            {
                "endpoints": EndpointService.list_endpoints(
                    tenant_id=tenant_id,
                    user_id=user.id,
                    page=page,
                    page_size=page_size,
                )
            }
        )


@console_ns.route("/workspaces/current/endpoints/list/plugin")
class EndpointListForSinglePluginApi(Resource):
    @console_ns.doc("list_plugin_endpoints")
    @console_ns.doc(description="List endpoints for a specific plugin")
    @console_ns.expect(console_ns.models[EndpointListForPluginQuery.__name__])
    @console_ns.response(
        200,
        "Success",
        console_ns.models[PluginEndpointListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        args = EndpointListForPluginQuery.model_validate(request.args.to_dict(flat=True))

        page = args.page
        page_size = args.page_size
        plugin_id = args.plugin_id

        return jsonable_encoder(
            {
                "endpoints": EndpointService.list_endpoints_for_single_plugin(
                    tenant_id=tenant_id,
                    user_id=user.id,
                    plugin_id=plugin_id,
                    page=page,
                    page_size=page_size,
                )
            }
        )


@console_ns.route("/workspaces/current/endpoints/<string:id>")
class EndpointItemApi(Resource):
    """Canonical item resource for endpoint updates and deletion."""

    @console_ns.doc("delete_endpoint")
    @console_ns.doc(description="Delete a plugin endpoint")
    @console_ns.doc(params={"id": {"description": "Endpoint ID", "type": "string", "required": True}})
    @console_ns.response(
        200,
        "Endpoint deleted successfully",
        console_ns.models[EndpointDeleteResponse.__name__],
    )
    @console_ns.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def delete(self, id: str):
        return _delete_endpoint(endpoint_id=id)

    @console_ns.doc("update_endpoint")
    @console_ns.doc(description="Update a plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointUpdatePayload.__name__])
    @console_ns.doc(params={"id": {"description": "Endpoint ID", "type": "string", "required": True}})
    @console_ns.response(
        200,
        "Endpoint updated successfully",
        console_ns.models[EndpointUpdateResponse.__name__],
    )
    @console_ns.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def patch(self, id: str):
        return _update_endpoint(endpoint_id=id)


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
        200,
        "Endpoint deleted successfully",
        console_ns.models[EndpointDeleteResponse.__name__],
    )
    @console_ns.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        args = EndpointIdPayload.model_validate(console_ns.payload)
        return _delete_endpoint(endpoint_id=args.endpoint_id)


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
        200,
        "Endpoint updated successfully",
        console_ns.models[EndpointUpdateResponse.__name__],
    )
    @console_ns.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        args = LegacyEndpointUpdatePayload.model_validate(console_ns.payload)
        return _update_endpoint(endpoint_id=args.endpoint_id)


@console_ns.route("/workspaces/current/endpoints/enable")
class EndpointEnableApi(Resource):
    @console_ns.doc("enable_endpoint")
    @console_ns.doc(description="Enable a plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointIdPayload.__name__])
    @console_ns.response(
        200,
        "Endpoint enabled successfully",
        console_ns.models[EndpointEnableResponse.__name__],
    )
    @console_ns.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        args = EndpointIdPayload.model_validate(console_ns.payload)

        return {
            "success": EndpointService.enable_endpoint(
                tenant_id=tenant_id, user_id=user.id, endpoint_id=args.endpoint_id
            )
        }


@console_ns.route("/workspaces/current/endpoints/disable")
class EndpointDisableApi(Resource):
    @console_ns.doc("disable_endpoint")
    @console_ns.doc(description="Disable a plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointIdPayload.__name__])
    @console_ns.response(
        200,
        "Endpoint disabled successfully",
        console_ns.models[EndpointDisableResponse.__name__],
    )
    @console_ns.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        args = EndpointIdPayload.model_validate(console_ns.payload)

        return {
            "success": EndpointService.disable_endpoint(
                tenant_id=tenant_id, user_id=user.id, endpoint_id=args.endpoint_id
            )
        }
