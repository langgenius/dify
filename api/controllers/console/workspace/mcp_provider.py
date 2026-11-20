"""Console transport for deleting an external MCP provider."""

from uuid import UUID

from pydantic import BaseModel

from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import RBACCheck, Workspace
from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, validate_request
from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from services.mcp_provider_service import MCPProviderNotFoundError


class MCPProviderDeletePayload(BaseModel):
    provider_id: str


register_schema_models(console_ns, MCPProviderDeletePayload, SimpleResultResponse)


class MCPProviderDeleteMixin:
    """Keep one registered MCP resource so POST, PUT, and DELETE share an OpenAPI path."""

    @console_ns.expect(console_ns.models[MCPProviderDeletePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.MCP_MANAGE, Workspace())])
    def delete(self, context: RequestContext) -> dict[str, str]:
        """Delete an external MCP provider in the current workspace.

        Requires an initialized account with MCP management permission and a UUID
        provider ID. Success means deletion committed. Invalid, absent, or foreign
        IDs leave providers unchanged and retain their existing error responses.
        """
        payload = validate_request(MCPProviderDeletePayload)
        try:
            UUID(payload.provider_id)
        except ValueError as error:
            raise ValueError("expected a valid UUID, but got: " + payload.provider_id) from error
        try:
            application_services().mcp_providers.delete(context, payload.provider_id)
        except MCPProviderNotFoundError as error:
            raise ValueError(str(error)) from error
        return SimpleResultResponse(result="success").model_dump(mode="json")
