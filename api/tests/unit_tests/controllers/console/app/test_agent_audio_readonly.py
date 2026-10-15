"""Agent audio previews never materialize or modify the runtime app."""

from collections.abc import Iterator
from http import HTTPStatus
from uuid import uuid4

import pytest
from sqlalchemy import Engine, delete, event, func, select, update
from sqlalchemy.orm import Session

from models import App
from models.agent import Agent, AgentScope
from models.model import AppMode
from tests.unit_tests.services.console_audio_fixtures import AudioOperation, ConsoleAudioHarness

pytest_plugins = (
    "tests.unit_tests.services.audio_runtime_fixtures",
    "tests.unit_tests.services.console_audio_fixtures",
)


@pytest.fixture
def persistence_events(sqlite_engine: Engine) -> Iterator[list[str]]:
    observed: list[str] = []

    def record_statement(
        _connection: object, _cursor: object, statement: str, _parameters: object, _context: object, _executemany: bool
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


@pytest.mark.parametrize("scope", [AgentScope.ROSTER, AgentScope.WORKFLOW_ONLY])
@pytest.mark.parametrize("operation", ["tts", "voices"])
def test_preview_uses_existing_runtime_without_writes(
    console_audio: ConsoleAudioHarness, persistence_events: list[str], scope: AgentScope, operation: AudioOperation
) -> None:
    console_audio.add_agent(scope=scope)
    persistence_events.clear()
    response = console_audio.request(
        operation,
        agent=True,
        payload={"language": "en-US"} if operation == "voices" else {"text": "Preview", "voice": "selected"},
    )
    try:
        assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
        assert console_audio.plugin.requests
        assert persistence_events == []
    finally:
        response.close()


@pytest.mark.parametrize("operation", ["tts", "voices"])
def test_workflow_agent_missing_backing_app_does_not_create_one(
    console_audio: ConsoleAudioHarness, persistence_events: list[str], operation: AudioOperation
) -> None:
    console_audio.add_agent(scope=AgentScope.WORKFLOW_ONLY, backing=False)
    # A real parent app is not an acceptable replacement for the backing app.
    with console_audio.factory.begin() as session:
        session.execute(update(Agent).where(Agent.id == console_audio.agent_id).values(app_id=console_audio.target.id))
        count = session.scalar(select(func.count()).select_from(App))
    persistence_events.clear()
    response = console_audio.request(
        operation, agent=True, payload={"language": "en-US"} if operation == "voices" else {"text": "Preview"}
    )
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert not console_audio.plugin.requests
    assert persistence_events == []
    with console_audio.factory() as session:
        assert session.scalar(select(func.count()).select_from(App)) == count
        agent = session.get(Agent, console_audio.agent_id)
        assert agent is not None
        assert agent.backing_app_id is None


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
@pytest.mark.parametrize("field", ["agent_tenant", "app_tenant", "app_mode", "app_missing"])
def test_agent_runtime_owner_chain_is_revalidated(
    console_audio: ConsoleAudioHarness, persistence_events: list[str], operation: AudioOperation, field: str
) -> None:
    console_audio.add_agent()
    with console_audio.factory.begin() as session:
        if field == "agent_tenant":
            session.execute(update(Agent).where(Agent.id == console_audio.agent_id).values(tenant_id=str(uuid4())))
        elif field == "app_missing":
            session.execute(delete(App).where(App.id == console_audio.target.id))
        else:
            values = {"tenant_id": str(uuid4())} if field == "app_tenant" else {"mode": AppMode.CHAT}
            session.execute(update(App).where(App.id == console_audio.target.id).values(values))
    persistence_events.clear()
    response = console_audio.request(
        operation,
        agent=True,
        payload={"language": "en-US"} if operation == "voices" else {"text": "Preview"} if operation == "tts" else {},
    )
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert not console_audio.plugin.requests
    assert persistence_events == []


@pytest.mark.parametrize("operation", ["tts", "voices"])
def test_provider_failure_does_not_write_runtime_state(
    console_audio: ConsoleAudioHarness, persistence_events: list[str], operation: AudioOperation
) -> None:
    console_audio.add_agent(scope=AgentScope.WORKFLOW_ONLY)
    console_audio.plugin.error = "InvokeServerUnavailableError"
    persistence_events.clear()
    response = console_audio.request(
        operation,
        agent=True,
        payload={"language": "en-US"} if operation == "voices" else {"text": "Preview", "voice": "selected"},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "completion_request_error"
    assert persistence_events == []


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
def test_plain_app_gate_hides_workflow_agent_backing_app(
    console_audio: ConsoleAudioHarness, operation: AudioOperation
) -> None:
    console_audio.add_agent(scope=AgentScope.WORKFLOW_ONLY)
    response = console_audio.request(
        operation,
        payload={"language": "en-US"} if operation == "voices" else {"text": "Preview"} if operation == "tts" else {},
    )
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert not console_audio.plugin.requests
