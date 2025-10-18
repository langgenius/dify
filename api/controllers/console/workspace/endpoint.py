from flask_restx import Resource, fields, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api, console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.impl.exc import PluginPermissionDeniedError
from libs.login import current_account_with_tenant, login_required
from services.plugin.endpoint_service import EndpointService


@console_ns.route("/workspaces/current/endpoints/create")
class EndpointCreateApi(Resource):
    @api.doc("create_endpoint")
    @api.doc(description="Create a new plugin endpoint")
    @api.expect(
        api.model(
            "EndpointCreateRequest",
            {
                "plugin_unique_identifier": fields.String(required=True, description="Plugin unique identifier"),
                "settings": fields.Raw(required=True, description="Endpoint settings"),
                "name": fields.String(required=True, description="Endpoint name"),
            },
        )
    )
    @api.response(
        200,
        "Endpoint created successfully",
        api.model("EndpointCreateResponse", {"success": fields.Boolean(description="Operation success")}),
    )
    @api.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()
        if not user.is_admin_or_owner:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("plugin_unique_identifier", type=str, required=True)
            .add_argument("settings", type=dict, required=True)
            .add_argument("name", type=str, required=True)
        )
        args = parser.parse_args()

        plugin_unique_identifier = args["plugin_unique_identifier"]
        settings = args["settings"]
        name = args["name"]

        try:
            return {
                "success": EndpointService.create_endpoint(
                    tenant_id=tenant_id,
                    user_id=user.id,
                    plugin_unique_identifier=plugin_unique_identifier,
                    name=name,
                    settings=settings,
                )
            }
        except PluginPermissionDeniedError as e:
            raise ValueError(e.description) from e


@console_ns.route("/workspaces/current/endpoints/list")
class EndpointListApi(Resource):
    @api.doc("list_endpoints")
    @api.doc(description="List plugin endpoints with pagination")
    @api.expect(
        api.parser()
        .add_argument("page", type=int, required=True, location="args", help="Page number")
        .add_argument("page_size", type=int, required=True, location="args", help="Page size")
    )
    @api.response(
        200,
        "Success",
        api.model("EndpointListResponse", {"endpoints": fields.List(fields.Raw(description="Endpoint information"))}),
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("page", type=int, required=True, location="args")
            .add_argument("page_size", type=int, required=True, location="args")
        )
        args = parser.parse_args()

        page = args["page"]
        page_size = args["page_size"]

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
    @api.doc("list_plugin_endpoints")
    @api.doc(description="List endpoints for a specific plugin")
    @api.expect(
        api.parser()
        .add_argument("page", type=int, required=True, location="args", help="Page number")
        .add_argument("page_size", type=int, required=True, location="args", help="Page size")
        .add_argument("plugin_id", type=str, required=True, location="args", help="Plugin ID")
    )
    @api.response(
        200,
        "Success",
        api.model(
            "PluginEndpointListResponse", {"endpoints": fields.List(fields.Raw(description="Endpoint information"))}
        ),
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("page", type=int, required=True, location="args")
            .add_argument("page_size", type=int, required=True, location="args")
            .add_argument("plugin_id", type=str, required=True, location="args")
        )
        args = parser.parse_args()

        page = args["page"]
        page_size = args["page_size"]
        plugin_id = args["plugin_id"]

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
    @api.doc("delete_endpoint")
    @api.doc(description="Delete a plugin endpoint")
    @api.expect(
        api.model("EndpointDeleteRequest", {"endpoint_id": fields.String(required=True, description="Endpoint ID")})
    )
    @api.response(
        200,
        "Endpoint deleted successfully",
        api.model("EndpointDeleteResponse", {"success": fields.Boolean(description="Operation success")}),
    )
    @api.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        parser = reqparse.RequestParser().add_argument("endpoint_id", type=str, required=True)
        args = parser.parse_args()

        if not user.is_admin_or_owner:
            raise Forbidden()

        endpoint_id = args["endpoint_id"]

        return {
            "success": EndpointService.delete_endpoint(tenant_id=tenant_id, user_id=user.id, endpoint_id=endpoint_id)
        }


@console_ns.route("/workspaces/current/endpoints/update")
class EndpointUpdateApi(Resource):
    @api.doc("update_endpoint")
    @api.doc(description="Update a plugin endpoint")
    @api.expect(
        api.model(
            "EndpointUpdateRequest",
            {
                "endpoint_id": fields.String(required=True, description="Endpoint ID"),
                "settings": fields.Raw(required=True, description="Updated settings"),
                "name": fields.String(required=True, description="Updated name"),
            },
        )
    )
    @api.response(
        200,
        "Endpoint updated successfully",
        api.model("EndpointUpdateResponse", {"success": fields.Boolean(description="Operation success")}),
    )
    @api.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("endpoint_id", type=str, required=True)
            .add_argument("settings", type=dict, required=True)
            .add_argument("name", type=str, required=True)
        )
        args = parser.parse_args()

        endpoint_id = args["endpoint_id"]
        settings = args["settings"]
        name = args["name"]

        if not user.is_admin_or_owner:
            raise Forbidden()

        return {
            "success": EndpointService.update_endpoint(
                tenant_id=tenant_id,
                user_id=user.id,
                endpoint_id=endpoint_id,
                name=name,
                settings=settings,
            )
        }


@console_ns.route("/workspaces/current/endpoints/enable")
class EndpointEnableApi(Resource):
    @api.doc("enable_endpoint")
    @api.doc(description="Enable a plugin endpoint")
    @api.expect(
        api.model("EndpointEnableRequest", {"endpoint_id": fields.String(required=True, description="Endpoint ID")})
    )
    @api.response(
        200,
        "Endpoint enabled successfully",
        api.model("EndpointEnableResponse", {"success": fields.Boolean(description="Operation success")}),
    )
    @api.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        parser = reqparse.RequestParser().add_argument("endpoint_id", type=str, required=True)
        args = parser.parse_args()

        endpoint_id = args["endpoint_id"]

        if not user.is_admin_or_owner:
            raise Forbidden()

        return {
            "success": EndpointService.enable_endpoint(tenant_id=tenant_id, user_id=user.id, endpoint_id=endpoint_id)
        }


@console_ns.route("/workspaces/current/endpoints/disable")
class EndpointDisableApi(Resource):
    @api.doc("disable_endpoint")
    @api.doc(description="Disable a plugin endpoint")
    @api.expect(
        api.model("EndpointDisableRequest", {"endpoint_id": fields.String(required=True, description="Endpoint ID")})
    )
    @api.response(
        200,
        "Endpoint disabled successfully",
        api.model("EndpointDisableResponse", {"success": fields.Boolean(description="Operation success")}),
    )
    @api.response(403, "Admin privileges required")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        parser = reqparse.RequestParser().add_argument("endpoint_id", type=str, required=True)
        args = parser.parse_args()

        endpoint_id = args["endpoint_id"]

        if not user.is_admin_or_owner:
            raise Forbidden()

        return {
            "success": EndpointService.disable_endpoint(tenant_id=tenant_id, user_id=user.id, endpoint_id=endpoint_id)
        }
