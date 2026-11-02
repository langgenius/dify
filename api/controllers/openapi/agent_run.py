"""Run routes for Agents on /openapi/v1: the published version, or the draft."""

from __future__ import annotations

from typing import Final

from flask import Response
from flask_restx import Resource

from constants.oauth_bearer import Scope
from controllers.common.rbac import AgentId, RBACCheck, RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint, op_of
from controllers.openapi._errors import AgentNotPublished, OpenApiError, ServiceApiDisabled
from controllers.openapi._models import AgentRunPayload, Hint
from controllers.openapi.app_run import STREAM_RESULT, generate_args, respond, stream, with_reply_hints
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    EDITOR_ROLES,
    CheckAppAccess,
    CheckAppMode,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
    service_api_hint,
)
from controllers.openapi.auth.subjects import AccountSubject
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import App, AppMode
from services.agent.roster_service import AgentRosterService, RosterAgentEntry

# Membership is asked before `CheckAppMode` loads the Agent, so a caller who may
# not use the workspace learns nothing about which Agents it holds. The Service
# API is not a guard: an unpublished Agent always has it off, so the refusal has
# to name publishing first (`run_refusal`), and a draft run never needs it.
_AGENT_RUN_GUARDS: Final = (
    CheckSubject(allowed=(AccountSubject,)),
    CheckWorkspaceMember(),
    CheckAppMode(AppMode.AGENT),
    CheckScope(Scope.APPS_RUN),
    CheckRBACPermission(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId())),
    CheckAppAccess(),
)
_AGENT_TEST_GUARDS: Final = (
    CheckSubject(allowed=(AccountSubject,)),
    CheckWorkspaceMember(),
    CheckAppMode(AppMode.AGENT),
    CheckScope(Scope.APPS_RUN),
    CheckRBACPermission(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId())),
    CheckWorkspaceRole(EDITOR_ROLES),
)


def agent_target(workspace_id: str, agent_id: str) -> dict[str, str]:
    """The path parameters that address an Agent, as the `input` of a hint to another Agent op."""
    return {"workspace_id": workspace_id, "agent_id": agent_id}


def draft_hint(target: dict[str, str]) -> Hint:
    return Hint(summary="Run this Agent's draft", op=op_of(AgentTestApi.post), input=target)


def run_refusal(entry: RosterAgentEntry, app: App, target: dict[str, str]) -> OpenApiError | None:
    """Why `run.agent` would refuse this Agent, carrying the hint that gets past it; None when it would run."""
    if not entry.published:
        return AgentNotPublished(hints=[draft_hint(target)])
    if not entry.service_api_enabled:
        return ServiceApiDisabled(hints=[service_api_hint(app)])
    return None


def _run_agent(
    ctx: Context, workspace_id: str, agent_id: str, body: AgentRunPayload, *, op: str, invoke_from: InvokeFrom
) -> Response:
    target = agent_target(workspace_id, agent_id)
    try:
        events = stream(ctx, generate_args(ctx, body), invoke_from)
    except AgentNotPublished as error:
        raise AgentNotPublished(hints=[draft_hint(target)]) from error
    return respond(ctx, with_reply_hints(events, op=op, target=target))


@openapi_ns.route("/workspaces/<string:workspace_id>/agents/<string:agent_id>:run")
class AgentRunApi(Resource):
    @endpoint(
        op="run.agent",
        kind=Kind.SSE,
        summary="Run a published Agent; streams message events",
        requirements=_AGENT_RUN_GUARDS,
        body=AgentRunPayload,
        examples=(
            Example(
                title="Start a new conversation",
                input={"agent_id": "<agent_id>", "query": "Summarise the latest release"},
            ),
            Example(
                title="Reply in an existing conversation",
                input={
                    "agent_id": "<agent_id>",
                    "query": "Summarise the latest release",
                    "conversation_id": "<conversation_id>",
                },
            ),
        ),
        returns=STREAM_RESULT,
    )
    def post(self, ctx: Context, workspace_id: str, agent_id: str, *, body: AgentRunPayload):
        # In the handler, after every guard: only a caller allowed to run the Agent learns why it can't.
        entry = AgentRosterService(ctx.session).describe_openapi_roster_agent(
            tenant_id=ctx.workspace.id, agent_id=agent_id, app=ctx.app
        )
        refusal = run_refusal(entry, ctx.app, agent_target(workspace_id, agent_id))
        if refusal is not None:
            raise refusal
        return _run_agent(ctx, workspace_id, agent_id, body, op=op_of(AgentRunApi.post), invoke_from=InvokeFrom.OPENAPI)


@openapi_ns.route("/workspaces/<string:workspace_id>/agents/<string:agent_id>:test")
class AgentTestApi(Resource):
    @endpoint(
        op="test.agent",
        kind=Kind.SSE,
        summary="Run an Agent's draft; streams message events",
        requirements=_AGENT_TEST_GUARDS,
        body=AgentRunPayload,
        examples=(
            Example(
                title="Test the draft with one message",
                input={"agent_id": "<agent_id>", "query": "Summarise the latest release"},
            ),
        ),
        returns=STREAM_RESULT,
    )
    def post(self, ctx: Context, workspace_id: str, agent_id: str, *, body: AgentRunPayload):
        return _run_agent(
            ctx, workspace_id, agent_id, body, op=op_of(AgentTestApi.post), invoke_from=InvokeFrom.DEBUGGER
        )
