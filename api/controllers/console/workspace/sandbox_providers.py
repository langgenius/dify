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
    @console_ns.doc("list_sandbox_providers")
    @console_ns.doc(description="Get list of available sandbox providers with configuration status")
    @console_ns.response(200, "Success", fields.List(fields.Raw(description="Sandbox provider information")))
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        providers = SandboxProviderService.list_providers(current_tenant_id)
        return jsonable_encoder([p.model_dump() for p in providers])


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
                activate=args["activate"],
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


activate_parser = reqparse.RequestParser()
activate_parser.add_argument("type", type=str, required=True, location="json")


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
            args = activate_parser.parse_args()
            result = SandboxProviderService.activate_provider(
                tenant_id=current_tenant_id,
                provider_type=provider_type,
                type=args["type"],
            )
            return result
        except ValueError as e:
            return {"message": str(e)}, 400
