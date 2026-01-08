import logging

from flask_restx import Resource, fields, reqparse

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.login import current_account_with_tenant, login_required
from services.sandbox.sandbox_provider_service import SandboxProviderService

logger = logging.getLogger(__name__)


@console_ns.route("/workspaces/current/sandbox-providers")
class SandboxProviderListApi(Resource):
    """List all sandbox providers for the current tenant."""

    @console_ns.doc("list_sandbox_providers")
    @console_ns.doc(description="Get list of available sandbox providers with configuration status")
    @console_ns.response(
        200,
        "Success",
        fields.List(fields.Raw(description="Sandbox provider information")),
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """List all sandbox providers."""
        _, current_tenant_id = current_account_with_tenant()
        providers = SandboxProviderService.list_providers(current_tenant_id)
        return jsonable_encoder([p.model_dump() for p in providers])


@console_ns.route("/workspaces/current/sandbox-provider/<string:provider_type>")
class SandboxProviderApi(Resource):
    """Get specific sandbox provider details."""

    @console_ns.doc("get_sandbox_provider")
    @console_ns.doc(description="Get specific sandbox provider details")
    @console_ns.doc(params={"provider_type": "Sandbox provider type (e2b, docker, local)"})
    @console_ns.response(200, "Success", fields.Raw(description="Sandbox provider details"))
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_type: str):
        """Get a specific sandbox provider."""
        _, current_tenant_id = current_account_with_tenant()
        provider = SandboxProviderService.get_provider(current_tenant_id, provider_type)
        if not provider:
            return {"message": f"Provider {provider_type} not found"}, 404
        return jsonable_encoder(provider.model_dump())


config_parser = reqparse.RequestParser()
config_parser.add_argument("config", type=dict, required=True, location="json")


@console_ns.route("/workspaces/current/sandbox-provider/<string:provider_type>/config")
class SandboxProviderConfigApi(Resource):
    @console_ns.doc("save_sandbox_provider_config")
    @console_ns.doc(description="Save or update configuration for a sandbox provider")
    @console_ns.expect(config_parser)
    @console_ns.response(200, "Success")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider_type: str):
        _, current_tenant_id = current_account_with_tenant()
        args = config_parser.parse_args()

        try:
            result = SandboxProviderService.save_config(
                tenant_id=current_tenant_id,
                provider_type=provider_type,
                config=args["config"],
            )
            return result
        except ValueError as e:
            return {"message": str(e)}, 400

    @console_ns.doc("delete_sandbox_provider_config")
    @console_ns.doc(description="Delete configuration for a sandbox provider")
    @console_ns.response(200, "Success")
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider_type: str):
        _, current_tenant_id = current_account_with_tenant()

        try:
            result = SandboxProviderService.delete_config(
                tenant_id=current_tenant_id,
                provider_type=provider_type,
            )
            return result
        except ValueError as e:
            return {"message": str(e)}, 400


@console_ns.route("/workspaces/current/sandbox-provider/<string:provider_type>/activate")
class SandboxProviderActivateApi(Resource):
    """Activate a sandbox provider."""

    @console_ns.doc("activate_sandbox_provider")
    @console_ns.doc(description="Activate a sandbox provider for the current workspace")
    @console_ns.response(200, "Success")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider_type: str):
        """Activate a sandbox provider."""
        _, current_tenant_id = current_account_with_tenant()

        try:
            result = SandboxProviderService.activate_provider(
                tenant_id=current_tenant_id,
                provider_type=provider_type,
            )
            return result
        except ValueError as e:
            return {"message": str(e)}, 400


@console_ns.route("/workspaces/current/sandbox-provider/active")
class SandboxProviderActiveApi(Resource):
    """Get the currently active sandbox provider."""

    @console_ns.doc("get_active_sandbox_provider")
    @console_ns.doc(description="Get the currently active sandbox provider for the workspace")
    @console_ns.response(200, "Success")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """Get the active sandbox provider."""
        _, current_tenant_id = current_account_with_tenant()
        active_provider = SandboxProviderService.get_active_provider(current_tenant_id)
        return {"provider_type": active_provider}
