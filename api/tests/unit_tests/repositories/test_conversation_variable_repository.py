"""Persistence scope and session lifetime of the Console variable query."""

from dataclasses import replace
from datetime import datetime, timedelta
from json import JSONDecodeError
from uuid import UUID

import pytest
from sqlalchemy import Engine, event, inspect, select
from sqlalchemy.dialects import mysql, postgresql
from sqlalchemy.orm import Session, sessionmaker

from factories import variable_factory
from graphon.variables import VariableBase
from machinery.context import RequestContext
from models import App, AppMode, ConversationVariable
from models.enums import ConversationFromSource
from models.model import Conversation, EndUser
from repositories.conversation_variable_repository import ConversationVariableRepository
from services.conversation_variable_query import ConversationVariableAppNotFoundError
from services.entities.conversation_entities import EndUserConversationRef
from services.errors.conversation import ConversationNotExistsError, ConversationVariableNotExistsError
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user

CONTEXT = RequestContext(request_id="request", trace_id=None, account_id="account-1", active_workspace_id="tenant-1")


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> ConversationVariableRepository:
    variable = variable_factory.build_conversation_variable_from_mapping(
        {"id": "draft-variable", "name": "example", "value_type": "string", "value": "value"}
    )
    with sqlite_session_factory.begin() as session:
        session.add(make_app(mode=AppMode.ADVANCED_CHAT))
        session.add(
            ConversationVariable.from_variable(app_id="app-1", conversation_id="conversation-1", variable=variable)
        )
    return ConversationVariableRepository(session_factory=sqlite_session_factory)


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
    repository: ConversationVariableRepository,
    workspace_id: str,
    app_id: str,
    conversation_id: str,
    expected_count: int,
) -> None:
    rows = repository.list_variables(CONTEXT._replace(active_workspace_id=workspace_id), app_id, conversation_id)
    assert len(rows) == expected_count


def test_app_transfer_after_admission_does_not_expose_variables(
    repository: ConversationVariableRepository, sqlite_session_factory: sessionmaker[Session]
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
    repository: ConversationVariableRepository,
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


_TIME = datetime(2026, 10, 12, 12, 0)


@pytest.fixture
def end_user_ref(sqlite_session_factory: sessionmaker[Session]) -> EndUserConversationRef:
    ref = EndUserConversationRef(
        app_id="app-1", tenant_id="tenant-1", end_user_id="end-user-1", conversation_id="conversation-1"
    )
    with sqlite_session_factory.begin() as session:
        session.add(make_app(mode=AppMode.ADVANCED_CHAT))
        session.add(make_end_user(app_id=ref.app_id))
        session.add(
            make_conversation(
                mode=AppMode.ADVANCED_CHAT,
                inputs={},
                from_source=ConversationFromSource.API,
                from_end_user_id=ref.end_user_id,
                is_deleted=False,
            )
        )
    return ref


def _variable(
    session: Session,
    ref: EndUserConversationRef,
    *,
    logical_id: str,
    name: str,
    created_at: datetime,
) -> ConversationVariable:
    variable = variable_factory.build_conversation_variable_from_mapping(
        {"id": logical_id, "name": name, "value_type": "string", "value": "original", "description": "Keep me"}
    )
    row = ConversationVariable.from_variable(app_id=ref.app_id, conversation_id=ref.conversation_id, variable=variable)
    row.created_at = created_at
    row.updated_at = created_at
    session.add(row)
    session.flush()
    return row


def _replacement(variable: VariableBase) -> VariableBase:
    return variable_factory.build_conversation_variable_from_mapping({**variable.model_dump(), "value": "updated"})


def test_end_user_page_preserves_storage_ids_order_limit_and_cursor(
    sqlite_session_factory: sessionmaker[Session], end_user_ref: EndUserConversationRef
) -> None:
    with sqlite_session_factory.begin() as session:
        newest = _variable(
            session, end_user_ref, logical_id="draft-new", name="New", created_at=_TIME + timedelta(seconds=2)
        )
        oldest = _variable(session, end_user_ref, logical_id="draft-old", name="Old", created_at=_TIME)
        middle = _variable(
            session, end_user_ref, logical_id="draft-mid", name="Middle", created_at=_TIME + timedelta(seconds=1)
        )
    repository = ConversationVariableRepository(session_factory=sqlite_session_factory)
    page = repository.get_page(ref=end_user_ref, last_id=None, limit=2, variable_name=None)
    assert [row.id for row in page.data] == [oldest.id, middle.id]
    assert page.data[0].variable.id == "draft-old"
    assert str(UUID(page.data[0].id)) == oldest.id
    assert page.limit == 2
    assert page.has_more is True
    assert page.data[0].created_at == page.data[0].updated_at == _TIME
    assert inspect(page.data[0], raiseerr=False) is None
    last = repository.get_page(ref=end_user_ref, last_id=middle.id, limit=2, variable_name=None)
    assert [row.id for row in last.data] == [newest.id]
    assert last.has_more is False
    empty = repository.get_page(ref=end_user_ref, last_id=newest.id, limit=2, variable_name=None)
    assert empty.data == ()
    assert empty.has_more is False
    with pytest.raises(ConversationVariableNotExistsError):
        repository.get_page(ref=end_user_ref, last_id="draft-mid", limit=2, variable_name=None)


def test_end_user_empty_page_and_strict_timestamp_cursor(
    sqlite_session_factory: sessionmaker[Session], end_user_ref: EndUserConversationRef
) -> None:
    repository = ConversationVariableRepository(session_factory=sqlite_session_factory)
    empty = repository.get_page(ref=end_user_ref, last_id=None, limit=20, variable_name=None)
    assert empty.data == ()
    assert empty.has_more is False
    with pytest.raises(ConversationVariableNotExistsError):
        repository.get_page(ref=end_user_ref, last_id="missing", limit=20, variable_name=None)
    with sqlite_session_factory.begin() as session:
        first = _variable(session, end_user_ref, logical_id="one", name="One", created_at=_TIME)
        _variable(session, end_user_ref, logical_id="two", name="Two", created_at=_TIME)
    page = repository.get_page(ref=end_user_ref, last_id=None, limit=1, variable_name=None)
    assert len(page.data) == 1
    assert page.has_more is True
    assert repository.get_page(ref=end_user_ref, last_id=first.id, limit=1, variable_name=None).data == ()


@pytest.mark.parametrize("search", ["CUSTOM", "stom", "%", "_", "\\"])
def test_name_filter_matches_literal_case_insensitive_substrings(
    sqlite_session_factory: sessionmaker[Session], end_user_ref: EndUserConversationRef, search: str
) -> None:
    with sqlite_session_factory.begin() as session:
        expected = _variable(session, end_user_ref, logical_id="match", name="Custom_%\\name", created_at=_TIME)
        decoy = _variable(session, end_user_ref, logical_id="decoy", name="Other name", created_at=_TIME)
    repository = ConversationVariableRepository(session_factory=sqlite_session_factory)
    page = repository.get_page(ref=end_user_ref, last_id=None, limit=20, variable_name=search)
    assert [row.id for row in page.data] == [expected.id]
    with pytest.raises(ConversationVariableNotExistsError):
        repository.get_page(ref=end_user_ref, last_id=decoy.id, limit=20, variable_name=search)


@pytest.mark.parametrize("dialect_name", ["postgresql", "mysql"])
def test_name_filter_compiles_for_database_json_types(dialect_name: str) -> None:
    expression = ConversationVariableRepository._name_filter(variable_name="custom_%", dialect_name=dialect_name)
    dialect = postgresql.dialect() if dialect_name == "postgresql" else mysql.dialect()
    compiled = expression.compile(dialect=dialect)
    statement = str(compiled)
    if dialect_name == "postgresql":
        assert "json_extract_path_text(CAST(workflow_conversation_variables.data AS JSON)" in statement
        assert "ILIKE" in statement
    else:
        assert "json_extract(workflow_conversation_variables.data" in statement
        assert "lower(" in statement
    assert "%custom\\_\\%%" in compiled.params.values()


def test_variable_queries_do_not_cross_app_or_conversation_composite_key(
    sqlite_session_factory: sessionmaker[Session], end_user_ref: EndUserConversationRef
) -> None:
    other = replace(end_user_ref, app_id="app-2", end_user_id="end-user-2", conversation_id="conversation-2")
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id=other.app_id, mode=AppMode.ADVANCED_CHAT))
        session.add(make_end_user(end_user_id=other.end_user_id, app_id=other.app_id))
        session.add(
            make_conversation(
                conversation_id=other.conversation_id,
                app_id=other.app_id,
                inputs={},
                from_source=ConversationFromSource.API,
                from_end_user_id=other.end_user_id,
                is_deleted=False,
            )
        )
        own = _variable(session, end_user_ref, logical_id="shared-draft-id", name="Shared name", created_at=_TIME)
        duplicate = _variable(session, other, logical_id="shared-draft-id", name="Shared name", created_at=_TIME)
        foreign = _variable(session, other, logical_id="foreign", name="Foreign", created_at=_TIME)
        _variable(
            session,
            replace(end_user_ref, app_id=other.app_id),
            logical_id="invalid-owner",
            name="Wrong app",
            created_at=_TIME,
        )
    repository = ConversationVariableRepository(session_factory=sqlite_session_factory)
    assert [
        row.id for row in repository.get_page(ref=end_user_ref, last_id=None, limit=20, variable_name=None).data
    ] == [own.id]
    with pytest.raises(ConversationVariableNotExistsError):
        repository.get_page(ref=end_user_ref, last_id=foreign.id, limit=20, variable_name=None)
    with pytest.raises(ConversationVariableNotExistsError):
        repository.update(ref=end_user_ref, variable_id=foreign.id, transform=_replacement)
    result = repository.update(ref=end_user_ref, variable_id=own.id, transform=_replacement)
    assert result.id == own.id == duplicate.id
    assert result.variable.id == "shared-draft-id"
    assert result.variable.name == "Shared name"
    assert result.variable.description == "Keep me"
    assert result.variable.value == "updated"
    with sqlite_session_factory() as session:
        stored = session.get_one(ConversationVariable, (own.id, end_user_ref.conversation_id))
        untouched = session.get_one(ConversationVariable, (duplicate.id, other.conversation_id))
        assert stored.to_variable().value == "updated"
        assert stored.updated_at == result.updated_at > _TIME
        assert stored.created_at == result.created_at == _TIME
        assert untouched.to_variable().value == "original"


@pytest.mark.parametrize("field", ["app_id", "tenant_id", "end_user_id", "conversation_id"])
@pytest.mark.parametrize("write", [False, True])
def test_ref_owner_fields_are_all_required(
    sqlite_session_factory: sessionmaker[Session], end_user_ref: EndUserConversationRef, field: str, write: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        row = _variable(session, end_user_ref, logical_id="own", name="Own", created_at=_TIME)
    repository = ConversationVariableRepository(session_factory=sqlite_session_factory)
    wrong_ref = replace(end_user_ref, **{field: "unknown"})
    if write:
        with pytest.raises(ConversationNotExistsError):
            repository.update(ref=wrong_ref, variable_id=row.id, transform=_replacement)
    else:
        with pytest.raises(ConversationNotExistsError):
            repository.get_page(ref=wrong_ref, last_id=None, limit=20, variable_name=None)


@pytest.mark.parametrize(
    "changed",
    [
        "app_deleted",
        "app_tenant",
        "end_user_deleted",
        "end_user_app",
        "end_user_tenant",
        "conversation_app",
        "conversation_end_user",
        "conversation_source",
        "conversation_account",
        "conversation_deleted",
    ],
)
@pytest.mark.parametrize("write", [False, True])
def test_owner_chain_is_rechecked_after_admission(
    sqlite_session_factory: sessionmaker[Session], end_user_ref: EndUserConversationRef, changed: str, write: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        row = _variable(session, end_user_ref, logical_id="own", name="Own", created_at=_TIME)
        app = session.get_one(App, end_user_ref.app_id)
        user = session.get_one(EndUser, end_user_ref.end_user_id)
        conversation = session.get_one(Conversation, end_user_ref.conversation_id)
        if changed == "app_deleted":
            session.delete(app)
        elif changed == "app_tenant":
            app.tenant_id = "other-tenant"
        elif changed == "end_user_deleted":
            session.delete(user)
        elif changed == "end_user_app":
            user.app_id = "other-app"
        elif changed == "end_user_tenant":
            user.tenant_id = "other-tenant"
        elif changed == "conversation_app":
            conversation.app_id = "other-app"
        elif changed == "conversation_end_user":
            conversation.from_end_user_id = "other-user"
        elif changed == "conversation_source":
            conversation.from_source = ConversationFromSource.CONSOLE
        elif changed == "conversation_account":
            conversation.from_account_id = "account-1"
        else:
            conversation.is_deleted = True
    repository = ConversationVariableRepository(session_factory=sqlite_session_factory)
    if write:
        with pytest.raises(ConversationNotExistsError):
            repository.update(ref=end_user_ref, variable_id=row.id, transform=_replacement)
    else:
        with pytest.raises(ConversationNotExistsError):
            repository.get_page(ref=end_user_ref, last_id=None, limit=20, variable_name=None)


@pytest.mark.parametrize("operation", ["read", "write", "decode_error", "transform_error"])
def test_variable_operations_release_sessions_and_roll_back_failed_transforms(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    end_user_ref: EndUserConversationRef,
    operation: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        row = _variable(session, end_user_ref, logical_id="own", name="Own", created_at=_TIME)
        if operation == "decode_error":
            row.data = "invalid json"
    repository = ConversationVariableRepository(session_factory=sqlite_session_factory)
    active_connections = 0

    def checkout(*_args: object) -> None:
        nonlocal active_connections
        active_connections += 1

    def checkin(*_args: object) -> None:
        nonlocal active_connections
        active_connections -= 1

    def failed_transform(variable: VariableBase) -> VariableBase:
        assert active_connections == 1
        assert variable.value == "original"
        raise ValueError("invalid replacement")

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        if operation == "decode_error":
            with pytest.raises(JSONDecodeError):
                repository.get_page(ref=end_user_ref, last_id=None, limit=20, variable_name=None)
        elif operation == "transform_error":
            with pytest.raises(ValueError, match="invalid replacement"):
                repository.update(ref=end_user_ref, variable_id=row.id, transform=failed_transform)
        elif operation == "write":
            repository.update(ref=end_user_ref, variable_id=row.id, transform=_replacement)
        else:
            repository.get_page(ref=end_user_ref, last_id=None, limit=20, variable_name=None)
        assert active_connections == 0
        if operation == "transform_error":
            with sqlite_session_factory() as session:
                stored = session.get_one(ConversationVariable, (row.id, end_user_ref.conversation_id))
                assert stored.to_variable().name == "Own"
                assert stored.to_variable().value == "original"
                assert stored.updated_at == _TIME
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)
