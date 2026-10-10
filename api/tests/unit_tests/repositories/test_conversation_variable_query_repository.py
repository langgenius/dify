"""Persistence scope and session lifetime of the Console variable query."""

from json import JSONDecodeError

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from factories import variable_factory
from machinery.context import RequestContext
from models import App, AppMode, ConversationVariable
from repositories.conversation_variable_query_repository import ConversationVariableQueryRepository
from services.conversation_variable_query import ConversationVariableAppNotFoundError
from tests.unit_tests.model_factories import make_app

CONTEXT = RequestContext(request_id="request", trace_id=None, account_id="account-1", active_workspace_id="tenant-1")


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> ConversationVariableQueryRepository:
    variable = variable_factory.build_conversation_variable_from_mapping(
        {"id": "draft-variable", "name": "example", "value_type": "string", "value": "value"}
    )
    with sqlite_session_factory.begin() as session:
        session.add(make_app(mode=AppMode.ADVANCED_CHAT))
        session.add(
            ConversationVariable.from_variable(app_id="app-1", conversation_id="conversation-1", variable=variable)
        )
    return ConversationVariableQueryRepository(session_factory=sqlite_session_factory)


@pytest.mark.parametrize(
    ("workspace_id", "app_id", "conversation_id", "expected_count"),
    [
        ("tenant-1", "app-1", "conversation-1", 1),
        ("tenant-2", "app-1", "conversation-1", 0),
        ("tenant-1", "app-2", "conversation-1", 0),
        ("tenant-1", "app-1", "conversation-2", 0),
    ],
)
def test_read_applies_owner_scope_without_relying_on_prior_admission(
    repository: ConversationVariableQueryRepository,
    workspace_id: str,
    app_id: str,
    conversation_id: str,
    expected_count: int,
) -> None:
    rows = repository.list_variables(CONTEXT._replace(active_workspace_id=workspace_id), app_id, conversation_id)
    assert len(rows) == expected_count


def test_app_transfer_after_admission_does_not_expose_variables(
    repository: ConversationVariableQueryRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repository.require_app(CONTEXT, "app-1")
    with sqlite_session_factory.begin() as session:
        app = session.get_one(App, "app-1")
        app.tenant_id = "tenant-2"

    assert repository.list_variables(CONTEXT, "app-1", "conversation-1") == []
    with pytest.raises(ConversationVariableAppNotFoundError):
        repository.require_app(CONTEXT, "app-1")
    new_context = CONTEXT._replace(active_workspace_id="tenant-2")
    repository.require_app(new_context, "app-1")
    assert len(repository.list_variables(new_context, "app-1", "conversation-1")) == 1


@pytest.mark.parametrize("corrupt", [False, True])
def test_read_releases_connection_even_if_variable_decoding_fails(
    repository: ConversationVariableQueryRepository,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    corrupt: bool,
) -> None:
    if corrupt:
        with sqlite_session_factory.begin() as session:
            row = session.scalars(select(ConversationVariable)).one()
            row.data = "not json"
    active_connections = 0
    checkouts = 0

    def checkout(*_args: object) -> None:
        nonlocal active_connections, checkouts
        active_connections += 1
        checkouts += 1

    def checkin(*_args: object) -> None:
        nonlocal active_connections
        active_connections -= 1

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        repository.require_app(CONTEXT, "app-1")
        assert active_connections == 0
        if corrupt:
            with pytest.raises(JSONDecodeError):
                repository.list_variables(CONTEXT, "app-1", "conversation-1")
        else:
            rows = repository.list_variables(CONTEXT, "app-1", "conversation-1")
            assert rows[0].variable.value == "value"
            assert rows[0].variable.model_dump()["name"] == "example"
        assert checkouts == 2
        assert active_connections == 0
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)
