"""Agent API access HTTP endpoints and response contracts."""

from http import HTTPStatus
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from configs import dify_config
from controllers.common.rbac import AgentId, RBACCheck
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, model_validate
from extensions.ext_application_services import application_services
from libs.external_api import error_responses
from libs.url_utils import normalize_api_base_url
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.agent.errors import AgentAccessNotReadyError, AgentNotFoundError
from services.app.agent_app_contracts import AgentApiAccess, AgentAppAccessNotReadyError, AgentAppNotFoundError


class AgentApiStatusPayload(BaseModel):
    enable_api: bool = Field(..., description="Enable or disable Agent service API")


class AgentApiAccessResponse(BaseModel):
    access_ready: bool
    enabled: bool
    service_api_base_url: str
    streaming_only: bool = True
    chat_endpoint: str
    stop_endpoint: str
    conversations_endpoint: str
    messages_endpoint: str
    files_upload_endpoint: str
    parameters_endpoint: str
    info_endpoint: str
    meta_endpoint: str
    api_rpm: int
    api_rph: int
    api_key_count: int


register_schema_models(console_ns, AgentApiStatusPayload)
register_response_schema_models(console_ns, AgentApiAccessResponse)


def _serialize_agent_api_access(access: AgentApiAccess) -> dict[str, object]:
    """Render detached access state using the configured or current API origin."""
    base_url = normalize_api_base_url(dify_config.SERVICE_API_URL or request.host_url.rstrip("/"))
    response = AgentApiAccessResponse(
        access_ready=access.access_ready,
        enabled=access.enabled,
        service_api_base_url=base_url,
        chat_endpoint=f"{base_url}/chat-messages",
        stop_endpoint=f"{base_url}/chat-messages/{{task_id}}/stop",
        conversations_endpoint=f"{base_url}/conversations",
        messages_endpoint=f"{base_url}/messages",
        files_upload_endpoint=f"{base_url}/files/upload",
        parameters_endpoint=f"{base_url}/parameters",
        info_endpoint=f"{base_url}/info",
        meta_endpoint=f"{base_url}/meta",
        api_rpm=access.api_rpm,
        api_rph=access.api_rph,
        api_key_count=access.api_key_count,
    )
    return response.model_dump(mode="json")


@console_ns.route("/agent/<uuid:agent_id>/api-access")
class AgentApiAccessApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.response(HTTPStatus.OK, "Agent service API access", console_ns.models[AgentApiAccessResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_ACCESS_POINT_VIEW, AgentId())])
    def get(self, request_context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return API access for an Agent visible to the admitted account."""
        try:
            access = application_services().agent_apps.api_access.get(request_context, str(agent_id))
        except AgentAppNotFoundError as exc:
            raise AgentNotFoundError from exc
        return _serialize_agent_api_access(access)


@console_ns.route("/agent/<uuid:agent_id>/api-enable")
class AgentApiStatusApi(Resource):
    @error_responses(AgentAccessNotReadyError, AgentNotFoundError)
    @console_ns.expect(console_ns.models[AgentApiStatusPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Agent service API status updated", console_ns.models[AgentApiAccessResponse.__name__]
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.ADMIN, TenantAccountRole.OWNER}),
        rbac_checks=[RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentId())],
    )
    @model_validate(AgentApiStatusPayload)
    def post(
        self, req_data: AgentApiStatusPayload, request_context: RequestContext, agent_id: UUID
    ) -> dict[str, object]:
        """Change API access for an Agent and return the committed state."""
        try:
            access = application_services().agent_apps.api_access.set_enabled(
                request_context, str(agent_id), req_data.enable_api
            )
        except AgentAppNotFoundError as exc:
            raise AgentNotFoundError from exc
        except AgentAppAccessNotReadyError as exc:
            raise AgentAccessNotReadyError from exc
        return _serialize_agent_api_access(access)
