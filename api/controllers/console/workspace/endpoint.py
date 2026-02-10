from typing import Any

from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, is_admin_or_owner_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.impl.exc import PluginPermissionDeniedError
from libs.login import current_account_with_tenant, login_required
from services.plugin.endpoint_service import EndpointService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class EndpointCreatePayload(BaseModel):
    plugin_unique_identifier: str
    settings: dict[str, Any]
    name: str = Field(min_length=1)


class EndpointIdPayload(BaseModel):
    endpoint_id: str


class EndpointUpdatePayload(EndpointIdPayload):
    settings: dict[str, Any]
    name: str = Field(min_length=1)


class EndpointListQuery(BaseModel):
    page: int = Field(ge=1)
    page_size: int = Field(gt=0)


class EndpointListForPluginQuery(EndpointListQuery):
    plugin_id: str


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(EndpointCreatePayload)
reg(EndpointIdPayload)
reg(EndpointUpdatePayload)
reg(EndpointListQuery)
reg(EndpointListForPluginQuery)


@console_ns.route("/workspaces/current/endpoints/create")
class EndpointCreateApi(Resource):
    @console_ns.doc("create_endpoint")
    @console_ns.doc(description="Create a new plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointCreatePayload.__name__])
    @console_ns.response(
        200,
        "Endpoint created successfully",
        console_ns.model("EndpointCreateResponse", {"success": fields.Boolean(description="Operation success")}),
    )
    @console_ns.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
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


@console_ns.route("/workspaces/current/endpoints/list")
class EndpointListApi(Resource):
    @console_ns.doc("list_endpoints")
    @console_ns.doc(description="List plugin endpoints with pagination")
    @console_ns.expect(console_ns.models[EndpointListQuery.__name__])
    @console_ns.response(
        200,
        "Success",
        console_ns.model(
            "EndpointListResponse", {"endpoints": fields.List(fields.Raw(description="Endpoint information"))}
        ),
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        args = EndpointListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

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
        console_ns.model(
            "PluginEndpointListResponse", {"endpoints": fields.List(fields.Raw(description="Endpoint information"))}
        ),
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        args = EndpointListForPluginQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

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


@console_ns.route("/workspaces/current/endpoints/delete")
class EndpointDeleteApi(Resource):
    @console_ns.doc("delete_endpoint")
    @console_ns.doc(description="Delete a plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointIdPayload.__name__])
    @console_ns.response(
        200,
        "Endpoint deleted successfully",
        console_ns.model("EndpointDeleteResponse", {"success": fields.Boolean(description="Operation success")}),
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
            "success": EndpointService.delete_endpoint(
                tenant_id=tenant_id, user_id=user.id, endpoint_id=args.endpoint_id
            )
        }


@console_ns.route("/workspaces/current/endpoints/update")
class EndpointUpdateApi(Resource):
    @console_ns.doc("update_endpoint")
    @console_ns.doc(description="Update a plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointUpdatePayload.__name__])
    @console_ns.response(
        200,
        "Endpoint updated successfully",
        console_ns.model("EndpointUpdateResponse", {"success": fields.Boolean(description="Operation success")}),
    )
    @console_ns.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        args = EndpointUpdatePayload.model_validate(console_ns.payload)

        return {
            "success": EndpointService.update_endpoint(
                tenant_id=tenant_id,
                user_id=user.id,
                endpoint_id=args.endpoint_id,
                name=args.name,
                settings=args.settings,
            )
        }


@console_ns.route("/workspaces/current/endpoints/enable")
class EndpointEnableApi(Resource):
    @console_ns.doc("enable_endpoint")
    @console_ns.doc(description="Enable a plugin endpoint")
    @console_ns.expect(console_ns.models[EndpointIdPayload.__name__])
    @console_ns.response(
        200,
        "Endpoint enabled successfully",
        console_ns.model("EndpointEnableResponse", {"success": fields.Boolean(description="Operation success")}),
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
        console_ns.model("EndpointDisableResponse", {"success": fields.Boolean(description="Operation success")}),
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
