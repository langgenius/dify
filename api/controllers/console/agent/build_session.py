"""Console operations for the current account's Agent Build conversation and draft."""

from http import HTTPStatus
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.rbac import AgentId, RBACCheck, RBACPermission
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from extensions.ext_application_services import application_services
from fields.agent_fields import AgentConfigDraftSummaryResponse
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from models.agent_config_entities import AgentSoulConfig
from services.agent.errors import (
    AgentBuildSandboxNotFoundError,
    AgentHomeSnapshotCreateFailedError,
    AgentHomeSnapshotTooLargeError,
    AgentNotFoundError,
    AgentSoulLockedError,
    AgentVersionConflictError,
    AgentVersionNotFoundError,
    InvalidComposerConfigError,
    PlaintextSecretNotAllowedError,
)
from services.app.agent_build_session_store import (
    AgentBuildAgentNotFoundError,
    AgentBuildApplyChangedError,
    AgentBuildBaseUnavailableError,
    AgentBuildBindingUnavailableError,
    AgentBuildDraft,
    AgentBuildDraftNotFoundError,
    AgentBuildInvalidConfigError,
    AgentBuildPlaintextSecretError,
    AgentBuildSnapshotFailedError,
    AgentBuildSnapshotTooLargeError,
    AgentBuildSoulLockedError,
)
from services.entities.agent_entities import ComposerSavePayload

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


class AgentBuildDraftCheckoutPayload(BaseModel):
    force: bool = Field(default=False, description="Overwrite the existing current-user build draft")


class AgentBuildDraftApplyResponse(BaseModel):
    result: str
    draft: dict[str, object]


register_schema_models(console_ns, AgentBuildDraftCheckoutPayload, ComposerSavePayload)
register_response_schema_models(
    console_ns,
    AgentDebugConversationRefreshResponse,
    AgentBuildDraftResponse,
    AgentBuildDraftApplyResponse,
    AgentSimpleResultResponse,
)


def _build_draft_response(draft: AgentBuildDraft) -> dict[str, object]:
    """Render the detached draft, preserving the legacy empty Soul representation."""
    return {
        "variant": "agent_app",
        "draft": dump_response(AgentConfigDraftSummaryResponse, draft.summary),
        "agent_soul": draft.agent_soul,
    }


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


@console_ns.route("/agent/<uuid:agent_id>/build-draft")
class AgentBuildDraftApi(Resource):
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
        return _build_draft_response(draft)

    @error_responses(AgentNotFoundError, AgentSoulLockedError, AgentVersionNotFoundError, InvalidComposerConfigError)
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Agent build draft saved", console_ns.models[AgentBuildDraftResponse.__name__])
    @console_account_admission(
        allowed_roles=_EDITING_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())],
    )
    @model_validate(ComposerSavePayload)
    def put(self, req_data: ComposerSavePayload, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Save the admitted account's Build draft and return its committed state."""
        try:
            draft = application_services().agent_apps.build_session.save_draft(context, str(agent_id), req_data)
        except AgentBuildAgentNotFoundError as exc:
            raise AgentNotFoundError from exc
        except AgentBuildBaseUnavailableError as exc:
            raise AgentVersionNotFoundError from exc
        except AgentBuildSoulLockedError as exc:
            raise AgentSoulLockedError(*exc.args) from exc
        except AgentBuildInvalidConfigError as exc:
            raise InvalidComposerConfigError(*exc.args) from exc
        return _build_draft_response(draft)

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


@console_ns.route("/agent/<uuid:agent_id>/build-draft/checkout")
class AgentBuildDraftCheckoutApi(Resource):
    @error_responses(AgentBuildSandboxNotFoundError, AgentNotFoundError, AgentVersionNotFoundError)
    @console_ns.expect(console_ns.models[AgentBuildDraftCheckoutPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Agent build draft checked out", console_ns.models[AgentBuildDraftResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=_EDITING_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())],
    )
    @model_validate(AgentBuildDraftCheckoutPayload)
    def post(
        self, req_data: AgentBuildDraftCheckoutPayload, context: RequestContext, agent_id: UUID
    ) -> dict[str, object]:
        """Copy the shared draft for the admitted account, or reuse the existing personal draft unless forced."""
        try:
            draft = application_services().agent_apps.build_session.checkout_draft(
                context, str(agent_id), force=req_data.force
            )
        except AgentBuildAgentNotFoundError as exc:
            raise AgentNotFoundError from exc
        except AgentBuildBaseUnavailableError as exc:
            raise AgentVersionNotFoundError from exc
        except AgentBuildBindingUnavailableError as exc:
            raise AgentBuildSandboxNotFoundError from exc
        return _build_draft_response(draft)


@console_ns.route("/agent/<uuid:agent_id>/build-draft/apply")
class AgentBuildDraftApplyApi(Resource):
    @error_responses(
        AgentBuildSandboxNotFoundError,
        AgentHomeSnapshotCreateFailedError,
        AgentHomeSnapshotTooLargeError,
        AgentNotFoundError,
        AgentVersionNotFoundError,
        AgentVersionConflictError,
        InvalidComposerConfigError,
        PlaintextSecretNotAllowedError,
    )
    @console_ns.response(
        HTTPStatus.OK, "Agent build draft applied", console_ns.models[AgentBuildDraftApplyResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=_EDITING_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())],
    )
    def post(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Apply the admitted account's Build draft to the shared draft and return its metadata."""
        try:
            draft = application_services().agent_apps.build_session.apply_draft(context, str(agent_id))
        except AgentBuildAgentNotFoundError as exc:
            raise AgentNotFoundError from exc
        except (AgentBuildDraftNotFoundError, AgentBuildBaseUnavailableError) as exc:
            raise AgentVersionNotFoundError from exc
        except AgentBuildBindingUnavailableError as exc:
            raise AgentBuildSandboxNotFoundError from exc
        except AgentBuildApplyChangedError as exc:
            raise AgentVersionConflictError from exc
        except AgentBuildSnapshotFailedError as exc:
            raise AgentHomeSnapshotCreateFailedError(*exc.args) from exc
        except AgentBuildSnapshotTooLargeError as exc:
            raise AgentHomeSnapshotTooLargeError(*exc.args) from exc
        except AgentBuildInvalidConfigError as exc:
            raise InvalidComposerConfigError(*exc.args) from exc
        except AgentBuildPlaintextSecretError as exc:
            raise PlaintextSecretNotAllowedError(*exc.args) from exc
        return {"result": "success", "draft": dump_response(AgentConfigDraftSummaryResponse, draft)}
