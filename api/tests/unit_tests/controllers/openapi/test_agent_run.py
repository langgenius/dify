from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Protocol, cast

import pytest
from flask import Flask, Response
from sqlalchemy.orm import Session

from constants.oauth_bearer import Scope
from controllers.common.rbac import AgentId, RBACCheck, RBACPermission
from controllers.openapi import app_run
from controllers.openapi._errors import AgentNotPublished
from controllers.openapi._models import AgentRunPayload
from controllers.openapi.agent_run import AgentRunApi, AgentTestApi
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_app
from controllers.openapi.auth.requirements import (
    EDITOR_ROLES,
    CheckAppAccess,
    CheckAppApiEnabled,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
    Requirement,
)
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import AccountSubject
from core.app.apps.agent_app.errors import AgentAppNotPublishedError
from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account
from models.model import App, AppMode
from tests.helpers.unit.controllers.openapi.auth._world import (
    OTHER_TENANT_ID,
    TENANT_ID,
    account_subject,
    make_account,
    make_app,
    make_tenant,
    persist,
)
from tests.unit_tests.controllers.openapi.auth.test_loaders import AGENT_APP_ID, AGENT_ID, _agent
from tests.unit_tests.controllers.openapi.auth.test_requirements import _canonical
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld

_AGENT_RUN_ROUTES = [
    pytest.param(AgentRunApi, "run.agent", InvokeFrom.OPENAPI, id="run"),
    pytest.param(AgentTestApi, "test.agent", InvokeFrom.DEBUGGER, id="test"),
]
_MESSAGE_END = {
    "event": "message_end",
    "conversation_id": "c1",
    "message_id": "m1",
    "created_at": 1,
    "id": "m1",
    "task_id": "t1",
}


@dataclass(frozen=True, slots=True)
class _GenerateCall:
    session: Session
    app_model: App
    user: Account
    args: dict[str, object]
    invoke_from: InvokeFrom
    streaming: bool


class _GenerateStub:
    """Stands in for `AppGenerateService`; keeps what the service was called with."""

    def __init__(self, chunks: Iterable[str], error: Exception | None) -> None:
        self.chunks = chunks
        self.error = error
        self.calls: list[_GenerateCall] = []

    def generate(
        self,
        *,
        session: Session,
        app_model: App,
        user: Account,
        args: dict[str, object],
        invoke_from: InvokeFrom,
        streaming: bool,
    ) -> Iterable[str]:
        self.calls.append(_GenerateCall(session, app_model, user, args, invoke_from, streaming))
        if self.error is not None:
            raise self.error
        return iter(self.chunks)


def _stub_generate(
    monkeypatch: pytest.MonkeyPatch, *, chunks: Iterable[str] = (), error: Exception | None = None
) -> _GenerateStub:
    stub = _GenerateStub(chunks, error)
    monkeypatch.setattr(app_run, "AppGenerateService", stub)
    return stub


@pytest.fixture
def agent_ctx(sqlite_session: Session) -> Context:
    persist(sqlite_session, make_tenant(), make_app(app_id=AGENT_APP_ID, mode=AppMode.AGENT), _agent())
    ctx = Context(account_subject(), sqlite_session, {"workspace_id": TENANT_ID, "agent_id": AGENT_ID})
    load_app(ctx)
    ctx._caller = make_account()
    return ctx


class EndpointOwner(Protocol):
    __spec__: EndpointSpec


class _AgentView(Protocol):
    __handler__: Callable[..., Response]


def _run(app: Flask, view: type[AgentRunApi | AgentTestApi], ctx: Context, body: AgentRunPayload) -> list[str]:
    api = view()
    with app.test_request_context(method="POST"):
        response = cast(_AgentView, view.post).__handler__(api, ctx, TENANT_ID, AGENT_ID, body=body)
        return [str(chunk) for chunk in response.response]


@pytest.mark.parametrize(("view", "op", "invoke_from"), _AGENT_RUN_ROUTES)
def test_agent_runs_use_the_agents_app(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    agent_ctx: Context,
    view: type[AgentRunApi | AgentTestApi],
    op: str,
    invoke_from: InvokeFrom,
) -> None:
    stub = _stub_generate(monkeypatch, chunks=[f"data: {json.dumps(_MESSAGE_END)}\n\n"])

    chunks = _run(app, view, agent_ctx, AgentRunPayload(query="hi"))

    [call] = stub.calls
    assert (call.app_model.id, call.invoke_from, call.user, call.streaming) == (
        AGENT_APP_ID,
        invoke_from,
        agent_ctx.caller,
        True,
    )
    assert json.loads(chunks[0][len("data: ") :])["hints"] == [
        {
            "summary": "Reply in this conversation",
            "op": op,
            "input": {"agent_id": AGENT_ID, "conversation_id": "c1", "query": None, "inputs": {}},
        }
    ]


def test_agent_run_passes_the_conversation(app: Flask, monkeypatch: pytest.MonkeyPatch, agent_ctx: Context) -> None:
    stub = _stub_generate(monkeypatch)
    conversation_id = "6f1c2a52-0d43-4f7e-9a3b-1c2d3e4f5a6b"

    _run(app, AgentRunApi, agent_ctx, AgentRunPayload(query="hi", conversation_id=conversation_id))

    args = stub.calls[0].args
    assert (args["query"], args["conversation_id"]) == ("hi", conversation_id)
    assert "workspace_id" not in args


def test_unpublished_agent_run_hints_the_draft(app: Flask, monkeypatch: pytest.MonkeyPatch, agent_ctx: Context) -> None:
    _stub_generate(monkeypatch, error=AgentAppNotPublishedError("Agent has not been published"))

    with pytest.raises(AgentNotPublished) as raised:
        _run(app, AgentRunApi, agent_ctx, AgentRunPayload(query="hi"))

    assert raised.value.error_code == "agent_not_published"
    assert [hint.model_dump() for hint in raised.value.hints or []] == [
        {"summary": "Run the draft instead", "op": "test.agent", "input": {"agent_id": AGENT_ID}, "form": None}
    ]


_ACCOUNT_ONLY = CheckSubject(allowed=(AccountSubject,))
_SHARED_GUARDS = (
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_RUN),
    CheckRBACPermission(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId())),
)


@pytest.mark.parametrize(
    ("view", "last_guard"),
    [(AgentRunApi, CheckAppAccess()), (AgentTestApi, CheckWorkspaceRole(EDITOR_ROLES))],
    ids=["run", "test"],
)
def test_agent_routes_declare_their_guards(view: type[AgentRunApi | AgentTestApi], last_guard: Requirement) -> None:
    spec = cast(EndpointOwner, view.post).__spec__

    assert [*map(_canonical, spec.requirements)] == [*map(_canonical, (_ACCOUNT_ONLY, *_SHARED_GUARDS, last_guard))]
    assert spec.context == "orm"


@pytest.mark.parametrize("op", ["run", "test"])
def test_an_agent_of_another_workspace_is_not_found_and_runs_nothing(
    admitted_bearer: AdmittedWorld, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, op: str
) -> None:
    persist(
        sqlite_session,
        make_app(app_id=AGENT_APP_ID, tenant_id=OTHER_TENANT_ID, mode=AppMode.AGENT),
        _agent(tenant_id=OTHER_TENANT_ID),
    )
    stub = _stub_generate(monkeypatch)

    response = admitted_bearer.client.post(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/agents/{AGENT_ID}:{op}",
        json={"query": "hi"},
        headers=admitted_bearer.headers,
    )

    assert (response.status_code, response.get_json()["message"]) == (404, "agent not found")
    assert stub.calls == []
