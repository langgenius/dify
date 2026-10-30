"""Run routes for Agents on /openapi/v1: the published version, or the draft."""

from __future__ import annotations

from typing import Final

from flask_restx import Resource

from constants.oauth_bearer import Scope
from controllers.common.rbac import AgentId, RBACCheck, RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint, op_of
from controllers.openapi._errors import AgentNotPublished
from controllers.openapi._models import AgentRunPayload, Hint
from controllers.openapi.app_run import _STREAM_RESULT, _generate_args, _respond, _stream, with_reply_hints
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    EDITOR_ROLES,
    CheckAppAccess,
    CheckAppApiEnabled,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
)
from controllers.openapi.auth.subjects import AccountSubject
from core.app.entities.app_invoke_entities import InvokeFrom

_AGENT_RUN_GUARDS: Final = (
    CheckSubject(allowed=(AccountSubject,)),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_RUN),
    CheckRBACPermission(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId())),
    CheckAppAccess(),
)
_AGENT_TEST_GUARDS: Final = (
    CheckSubject(allowed=(AccountSubject,)),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_RUN),
    CheckRBACPermission(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId())),
    CheckWorkspaceRole(EDITOR_ROLES),
)


def _run_agent(ctx: Context, agent_id: str, body: AgentRunPayload, *, op: str, invoke_from: InvokeFrom):
    try:
        stream = _stream(ctx, _generate_args(ctx, body), invoke_from)
    except AgentNotPublished as error:
        draft = Hint(summary="Run the draft instead", op=op_of(AgentTestApi.post), input={"agent_id": agent_id})
        raise AgentNotPublished(hints=[draft]) from error
    return _respond(ctx, with_reply_hints(stream, op=op, target={"agent_id": agent_id}))


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
        returns=_STREAM_RESULT,
    )
    def post(self, ctx: Context, workspace_id: str, agent_id: str, *, body: AgentRunPayload):
        return _run_agent(ctx, agent_id, body, op=op_of(AgentRunApi.post), invoke_from=InvokeFrom.OPENAPI)


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
        returns=_STREAM_RESULT,
    )
    def post(self, ctx: Context, workspace_id: str, agent_id: str, *, body: AgentRunPayload):
        return _run_agent(ctx, agent_id, body, op=op_of(AgentTestApi.post), invoke_from=InvokeFrom.DEBUGGER)
