from collections.abc import Callable, Iterator
from unittest.mock import Mock
from uuid import UUID

import pytest
from flask import Flask, Response
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session
from werkzeug.exceptions import InternalServerError

from controllers.console import wraps
from controllers.console.app import audio
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeError
from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus
from models.model import App, AppMode
from services.agent.errors import AgentNotFoundError
from services.audio_service import AudioService
from tests.unit_tests.model_factories import make_account, make_app

AGENT_ID = UUID("019ef3d2-b24c-7803-b428-18b5ee8fb853")


@pytest.fixture(autouse=True)
def audio_identity(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> None:
    config_overrides(LOGIN_DISABLED=True, RBAC_ENABLED=True)
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: (make_account(), "tenant-1"))
    monkeypatch.setattr(audio, "enforce_rbac_checks", lambda **_kwargs: None)


@pytest.fixture
def persistence_events(sqlite_engine: Engine) -> Iterator[list[str]]:
    observed: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        operation = statement.lstrip().split(maxsplit=1)[0].upper()
        if operation in {"INSERT", "UPDATE", "DELETE"}:
            observed.append(operation)

    def record_commit(_session: Session) -> None:
        observed.append("COMMIT")

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    event.listen(Session, "before_commit", record_commit)
    try:
        yield observed
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)
        event.remove(Session, "before_commit", record_commit)


@pytest.fixture(params=["voices", "preview"])
def request_audio(
    request: pytest.FixtureRequest, app: Flask, monkeypatch: pytest.MonkeyPatch
) -> tuple[Callable[[], object], Mock]:
    if request.param == "voices":
        provider = Mock(return_value=[{"name": "Echo", "value": "echo"}])
        monkeypatch.setattr(AudioService, "transcript_tts_voices", provider)

        def invoke() -> object:
            with app.test_request_context(f"/console/api/agent/{AGENT_ID}/text-to-audio/voices?language=en-US"):
                return audio.AgentTextToSpeechVoicesApi().get(agent_id=AGENT_ID)

    else:
        provider = Mock(return_value=Response(b"ID3audio", content_type="audio/mpeg"))
        monkeypatch.setattr(AudioService, "transcript_tts", provider)

        def invoke() -> object:
            with app.test_request_context(
                f"/console/api/agent/{AGENT_ID}/text-to-audio",
                method="POST",
                json={"text": "Preview this voice", "voice": "echo"},
            ):
                return audio.AgentChatMessageTextApi().post(agent_id=AGENT_ID)

    return invoke, provider


def _agent(scope: AgentScope = AgentScope.WORKFLOW_ONLY) -> Agent:
    workflow_only = scope == AgentScope.WORKFLOW_ONLY
    return Agent(
        id=str(AGENT_ID),
        tenant_id="tenant-1",
        name="Audio agent",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=scope,
        source=AgentSource.WORKFLOW if workflow_only else AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="parent-app-1" if workflow_only else "runtime-app-1",
        backing_app_id="runtime-app-1" if workflow_only else None,
        workflow_id="workflow-1" if workflow_only else None,
        workflow_node_id="node-1" if workflow_only else None,
        created_by="account-1",
        updated_by="account-1",
    )


@pytest.mark.parametrize("scope", [AgentScope.ROSTER, AgentScope.WORKFLOW_ONLY])
def test_audio_uses_existing_runtime_state_without_writes(
    sqlite_session: Session,
    request_audio: tuple[Callable[[], object], Mock],
    persistence_events: list[str],
    scope: AgentScope,
) -> None:
    agent = _agent(scope)
    runtime_app = make_app(app_id="runtime-app-1", mode=AppMode.AGENT)
    sqlite_session.add_all([agent, runtime_app])
    sqlite_session.commit()
    persistence_events.clear()
    invoke, provider = request_audio

    response = invoke()

    provider.assert_called_once()
    assert response is not None
    assert persistence_events == []


def test_audio_does_not_materialize_a_missing_workflow_backing_app(
    sqlite_session: Session,
    request_audio: tuple[Callable[[], object], Mock],
    persistence_events: list[str],
) -> None:
    agent = _agent()
    agent.backing_app_id = None
    parent_app = make_app(app_id="parent-app-1", mode=AppMode.WORKFLOW)
    sqlite_session.add_all([agent, parent_app])
    sqlite_session.commit()
    persistence_events.clear()
    invoke, provider = request_audio

    with pytest.raises(AgentNotFoundError):
        invoke()

    provider.assert_not_called()
    assert persistence_events == []
    sqlite_session.refresh(agent)
    assert agent.backing_app_id is None
    assert sqlite_session.get(App, "runtime-app-1") is None


@pytest.mark.parametrize("foreign_owner", ["agent", "app"])
def test_audio_scopes_both_agent_and_runtime_app_to_the_current_tenant(
    sqlite_session: Session,
    request_audio: tuple[Callable[[], object], Mock],
    persistence_events: list[str],
    foreign_owner: str,
) -> None:
    agent = _agent()
    runtime_app = make_app(app_id="runtime-app-1", mode=AppMode.AGENT)
    if foreign_owner == "agent":
        agent.tenant_id = "tenant-2"
    else:
        runtime_app.tenant_id = "tenant-2"
    sqlite_session.add_all([agent, runtime_app])
    sqlite_session.commit()
    persistence_events.clear()
    invoke, provider = request_audio

    with pytest.raises(AgentNotFoundError):
        invoke()

    provider.assert_not_called()
    assert persistence_events == []


@pytest.mark.parametrize(
    ("provider_error", "expected_error"),
    [
        (ProviderTokenNotInitError("No TTS model configured"), ProviderNotInitializeError),
        (QuotaExceededError(), ProviderQuotaExceededError),
        (ModelCurrentlyNotSupportError(), ProviderModelCurrentlyNotSupportError),
        (InvokeError("TTS provider unavailable"), CompletionRequestError),
        (ValueError("Unknown voice"), ValueError),
        (RuntimeError("Unexpected provider failure"), InternalServerError),
    ],
)
def test_provider_failures_preserve_error_contract_and_readonly_state(
    sqlite_session: Session,
    request_audio: tuple[Callable[[], object], Mock],
    persistence_events: list[str],
    provider_error: Exception,
    expected_error: type[Exception],
) -> None:
    sqlite_session.add_all([_agent(AgentScope.ROSTER), make_app(app_id="runtime-app-1", mode=AppMode.AGENT)])
    sqlite_session.commit()
    persistence_events.clear()
    invoke, provider = request_audio
    provider.side_effect = provider_error

    with pytest.raises(expected_error):
        invoke()

    provider.assert_called_once()
    assert persistence_events == []
