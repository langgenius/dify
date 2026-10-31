from __future__ import annotations

import json
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import pytest
from flask import Flask, Response
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

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
from controllers.openapi.auth.spec import spec_of
from controllers.openapi.auth.subjects import AccountSubject
from core.app.apps.agent_app.errors import AgentAppNotPublishedError
from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account
from models.model import App, AppMode
from tests.helpers.unit.controllers.openapi.auth._world import (
    AGENT_APP_ID,
    AGENT_ID,
    OTHER_TENANT_ID,
    TENANT_ID,
    account_subject,
    canonical,
    make_account,
    make_agent,
    make_app,
    make_tenant,
    persist,
)
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
    persist(sqlite_session, make_tenant(), make_app(app_id=AGENT_APP_ID, mode=AppMode.AGENT), make_agent())
    ctx = Context(account_subject(), sqlite_session, {"workspace_id": TENANT_ID, "agent_id": AGENT_ID})
    load_app(ctx)
    ctx._caller = make_account()
    return ctx


@runtime_checkable
class _AgentView(Protocol):
    __handler__: Callable[..., Response]


def _run(app: Flask, view: type[AgentRunApi | AgentTestApi], ctx: Context, body: AgentRunPayload) -> list[str]:
    api = view()
    endpoint = view.post
    assert isinstance(endpoint, _AgentView)
    with app.test_request_context(method="POST"):
        response = endpoint.__handler__(api, ctx, TENANT_ID, AGENT_ID, body=body)
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
            "input": {
                "workspace_id": TENANT_ID,
                "agent_id": AGENT_ID,
                "conversation_id": "c1",
                "query": None,
                "inputs": {},
            },
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
        {
            "summary": "Run the draft instead",
            "op": "test.agent",
            "input": {"workspace_id": TENANT_ID, "agent_id": AGENT_ID},
            "form": None,
        }
    ]


_ACCOUNT_ONLY = CheckSubject(allowed=(AccountSubject,))
_SHARED_GUARDS = (
    CheckWorkspaceMember(),
    CheckAppApiEnabled(),
    CheckScope(Scope.APPS_RUN),
    CheckRBACPermission(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId())),
)


@pytest.mark.parametrize(
    ("view", "last_guard"),
    [(AgentRunApi, CheckAppAccess()), (AgentTestApi, CheckWorkspaceRole(EDITOR_ROLES))],
    ids=["run", "test"],
)
def test_agent_routes_declare_their_guards(view: type[AgentRunApi | AgentTestApi], last_guard: Requirement) -> None:
    spec = spec_of(view.post)
    assert spec is not None

    assert [*map(canonical, spec.requirements)] == [*map(canonical, (_ACCOUNT_ONLY, *_SHARED_GUARDS, last_guard))]
    assert spec.context == "orm"


@pytest.mark.parametrize("op", ["run", "test"])
def test_an_agent_of_another_workspace_is_not_found_and_runs_nothing(
    admitted_bearer: AdmittedWorld, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, op: str
) -> None:
    persist(
        sqlite_session,
        make_app(app_id=AGENT_APP_ID, tenant_id=OTHER_TENANT_ID, mode=AppMode.AGENT),
        make_agent(tenant_id=OTHER_TENANT_ID),
    )
    stub = _stub_generate(monkeypatch)

    response = admitted_bearer.client.post(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/agents/{AGENT_ID}:{op}",
        json={"query": "hi"},
        headers=admitted_bearer.headers,
    )

    assert (response.status_code, response.get_json()["message"]) == (404, "agent not found")
    assert stub.calls == []


@pytest.mark.parametrize("op", ["run", "test"])
def test_an_agent_with_its_service_api_off_is_refused_and_runs_nothing(
    admitted_bearer: AdmittedWorld, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, op: str
) -> None:
    persist(
        sqlite_session,
        make_app(app_id=AGENT_APP_ID, tenant_id=admitted_bearer.workspace_id, mode=AppMode.AGENT, enable_api=False),
        make_agent(tenant_id=admitted_bearer.workspace_id),
    )
    stub = _stub_generate(monkeypatch)

    response = admitted_bearer.client.post(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/agents/{AGENT_ID}:{op}",
        json={"query": "hi"},
        headers=admitted_bearer.headers,
    )

    body = response.get_json()
    assert (response.status_code, body["code"]) == (403, "service_api_disabled")
    assert body["hints"] == [
        {
            "summary": "Turn the Service API on",
            "op": "set.service_api.agent",
            "input": {"app_id": AGENT_APP_ID, "enabled": True},
        }
    ]
    assert stub.calls == []


_UNDASHED_AGENT_ID = uuid.UUID(AGENT_ID).hex


def _post_undashed(world: AdmittedWorld, sqlite_session: Session, op: str) -> TestResponse:
    persist(
        sqlite_session,
        make_app(app_id=AGENT_APP_ID, tenant_id=world.workspace_id, mode=AppMode.AGENT),
        make_agent(tenant_id=world.workspace_id),
    )
    return world.client.post(
        f"/openapi/v1/workspaces/{world.workspace_id}/agents/{_UNDASHED_AGENT_ID}:{op}",
        json={"query": "hi"},
        headers=world.headers,
    )


@pytest.mark.parametrize("op", ["run", "test"])
def test_an_undashed_agent_id_reaches_the_rbac_check_and_the_reply_hints_dashed(
    admitted_bearer: AdmittedWorld,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    op: str,
) -> None:
    config_overrides(RBAC_ENABLED=True)
    seen: list[dict[str, object]] = []
    monkeypatch.setattr(
        "controllers.openapi.auth.requirements.enforce_rbac_checks", lambda **kwargs: seen.append(kwargs["path_args"])
    )
    _stub_generate(monkeypatch, chunks=[f"data: {json.dumps(_MESSAGE_END)}\n\n"])

    response = _post_undashed(admitted_bearer, sqlite_session, op)

    [path_args] = seen
    assert path_args["agent_id"] == AGENT_ID
    [event] = response.get_data(as_text=True).split("\n\n")[:1]
    assert json.loads(event[len("data: ") :])["hints"][0]["input"]["agent_id"] == AGENT_ID


def test_an_undashed_agent_id_is_hinted_dashed_when_the_run_needs_the_draft(
    admitted_bearer: AdmittedWorld, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_generate(monkeypatch, error=AgentAppNotPublishedError("Agent has not been published"))

    response = _post_undashed(admitted_bearer, sqlite_session, "run")

    [hint] = response.get_json()["hints"]
    assert (hint["op"], hint["input"]["agent_id"]) == ("test.agent", AGENT_ID)


@pytest.mark.parametrize("op", ["run", "test"])
def test_a_malformed_agent_id_is_not_found_and_runs_nothing(
    admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch, op: str
) -> None:
    stub = _stub_generate(monkeypatch)

    response = admitted_bearer.client.post(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/agents/not-a-uuid:{op}",
        json={"query": "hi"},
        headers=admitted_bearer.headers,
    )

    assert (response.status_code, response.get_json()["message"]) == (404, "agent not found")
    assert stub.calls == []
