"""Console operations for the current account's Agent Build conversation and draft."""

from http import HTTPStatus
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel

from controllers.common.rbac import AgentId, RBACCheck, RBACPermission
from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from extensions.ext_application_services import application_services
from fields.agent_fields import AgentConfigDraftSummaryResponse
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from models.agent_config_entities import AgentSoulConfig
from services.agent.errors import AgentBuildSandboxNotFoundError, AgentNotFoundError, AgentVersionNotFoundError
from services.app.agent_build_session_store import (
    AgentBuildAgentNotFoundError,
    AgentBuildBindingUnavailableError,
    AgentBuildDraftNotFoundError,
)

_EDITING_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})


class AgentDebugConversationRefreshResponse(BaseModel):
    debug_conversation_id: str
    debug_conversation_has_messages: bool = False
    debug_conversation_message_count: int = 0


class AgentBuildDraftResponse(ResponseModel):
    variant: str
    draft: AgentConfigDraftSummaryResponse
    agent_soul: AgentSoulConfig


class AgentSimpleResultResponse(BaseModel):
    result: str


register_response_schema_models(
    console_ns,
    AgentDebugConversationRefreshResponse,
    AgentBuildDraftResponse,
    AgentSimpleResultResponse,
)


@console_ns.route("/agent/<uuid:agent_id>/debug-conversation/refresh")
class AgentDebugConversationRefreshApi(Resource):
    @error_responses(AgentBuildSandboxNotFoundError, AgentNotFoundError)
    @console_ns.response(
        HTTPStatus.OK,
        "Agent debug conversation refreshed",
        console_ns.models[AgentDebugConversationRefreshResponse.__name__],
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=_EDITING_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId())],
    )
    def post(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Reset the admitted account's Build conversation and return the new empty conversation."""
        try:
            conversation_id = application_services().agent_apps.build_session.refresh_conversation(
                context, str(agent_id)
            )
        except AgentBuildAgentNotFoundError as exc:
            raise AgentNotFoundError from exc
        except AgentBuildBindingUnavailableError as exc:
            raise AgentBuildSandboxNotFoundError from exc
        return dump_response(AgentDebugConversationRefreshResponse, {"debug_conversation_id": conversation_id})


class AgentBuildDraftHandlers:
    """Read and discard handlers for the draft route, whose PUT still uses the legacy composer."""

    @error_responses(AgentVersionNotFoundError)
    @console_ns.response(HTTPStatus.OK, "Agent build draft", console_ns.models[AgentBuildDraftResponse.__name__])
    @console_ns.response(HTTPStatus.NOT_FOUND, "Agent build draft not found")
    @console_account_admission(
        allowed_roles=_EDITING_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())],
    )
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return the admitted account's existing Build draft, or 404 when none exists."""
        try:
            draft = application_services().agent_apps.build_session.get_draft(context, str(agent_id))
        except AgentBuildDraftNotFoundError as exc:
            raise AgentVersionNotFoundError from exc
        # Keep the legacy empty Soul representation for old rows with an empty stored config.
        return {
            "variant": "agent_app",
            "draft": dump_response(AgentConfigDraftSummaryResponse, draft.summary),
            "agent_soul": draft.agent_soul,
        }

    @error_responses(AgentBuildSandboxNotFoundError, AgentNotFoundError)
    @console_ns.response(
        HTTPStatus.OK, "Agent build draft discarded", console_ns.models[AgentSimpleResultResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=_EDITING_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())],
    )
    def delete(self, context: RequestContext, agent_id: UUID) -> dict[str, str]:
        """Discard the caller's draft and report success even if it was already absent."""
        try:
            application_services().agent_apps.build_session.discard_draft(context, str(agent_id))
        except AgentBuildAgentNotFoundError as exc:
            raise AgentNotFoundError from exc
        except AgentBuildBindingUnavailableError as exc:
            raise AgentBuildSandboxNotFoundError from exc
        return {"result": "success"}
