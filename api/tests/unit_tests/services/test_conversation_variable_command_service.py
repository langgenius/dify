"""Variable update policy through real factories and owned SQLite transactions."""

from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from factories import variable_factory
from graphon.variables.exc import VariableError
from libs.datetime_utils import naive_utc_now
from models import ConversationVariable
from models.enums import ConversationFromSource, EndUserType
from repositories.conversation_variable_repository import ConversationVariableRepository
from services.conversation_variable_command_service import ConversationVariableCommandService
from services.entities.conversation_entities import EndUserConversationRef
from services.errors.conversation import ConversationVariableNotExistsError, ConversationVariableTypeMismatchError
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user

_CREATED_AT = datetime(2024, 1, 1, 9, 0, 0)


@pytest.fixture
def ref(sqlite_session_factory: sessionmaker[Session]) -> EndUserConversationRef:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_app(),
                make_end_user(app_id="app-1", end_user_type=EndUserType.SERVICE_API),
                make_conversation(inputs={}, from_source=ConversationFromSource.API, from_end_user_id="end-user-1"),
            ]
        )
    return EndUserConversationRef(
        app_id="app-1", tenant_id="tenant-1", end_user_id="end-user-1", conversation_id="conversation-1"
    )


@pytest.fixture
def commands(sqlite_session_factory: sessionmaker[Session]) -> ConversationVariableCommandService:
    return ConversationVariableCommandService(
        variables=ConversationVariableRepository(session_factory=sqlite_session_factory)
    )


def _seed_variable(
    factory: sessionmaker[Session],
    *,
    ref: EndUserConversationRef,
    value_type: str,
    value: JsonValue,
    logical_id: str,
) -> ConversationVariable:
    variable = variable_factory.build_conversation_variable_from_mapping(
        {
            "id": logical_id,
            "name": "topic",
            "description": "Keep this description",
            "selector": ["conversation", "topic"],
            "value_type": value_type,
            "value": value,
        }
    )
    row = ConversationVariable.from_variable(app_id=ref.app_id, conversation_id=ref.conversation_id, variable=variable)
    row.created_at = row.updated_at = _CREATED_AT
    with factory.begin() as session:
        session.add(row)
        session.flush()
        session.expunge(row)
    return row


@pytest.mark.parametrize(
    ("value_type", "original", "replacement"),
    [
        ("string", "original", ""),
        ("secret", "original", "new secret"),
        ("integer", 1, 42),
        ("integer", 1, 0),
        ("float", 1.5, 2.5),
        ("boolean", True, False),
        ("object", {"original": "value"}, {"zero": 0, "nested": [False, None]}),
        ("array[string]", ["original"], []),
        ("array[number]", [1], [0, 2.5]),
        ("array[boolean]", [True], [False]),
        ("array[object]", [{"original": "value"}], [{"nested": {"zero": 0}}]),
    ],
)
def test_update_validates_and_persists_value_without_changing_metadata(
    sqlite_session_factory: sessionmaker[Session],
    ref: EndUserConversationRef,
    commands: ConversationVariableCommandService,
    value_type: str,
    original: JsonValue,
    replacement: JsonValue,
) -> None:
    row = _seed_variable(
        sqlite_session_factory, ref=ref, value_type=value_type, value=original, logical_id=str(uuid4())
    )
    before = naive_utc_now()
    result = commands.update_value(ref=ref, variable_id=row.id, new_value=replacement)
    after = naive_utc_now()

    assert result.id == row.id
    assert result.created_at == _CREATED_AT
    assert before <= result.updated_at <= after
    assert result.variable.value == replacement
    assert result.variable.model_dump(exclude={"value"}) == row.to_variable().model_dump(exclude={"value"})
    with sqlite_session_factory() as session:
        persisted = session.get_one(ConversationVariable, (row.id, ref.conversation_id))
        assert persisted.to_variable() == result.variable


def test_imported_logical_id_keeps_storage_uuid_for_pagination_and_updates(
    sqlite_session_factory: sessionmaker[Session],
    ref: EndUserConversationRef,
    commands: ConversationVariableCommandService,
) -> None:
    row = _seed_variable(
        sqlite_session_factory, ref=ref, value_type="string", value="original", logical_id="imported-topic"
    )
    next_variable = variable_factory.build_conversation_variable_from_mapping(
        {"id": str(uuid4()), "name": "next", "value_type": "string", "value": "next value"}
    )
    next_row = ConversationVariable.from_variable(
        app_id=ref.app_id, conversation_id=ref.conversation_id, variable=next_variable
    )
    next_row.created_at = _CREATED_AT + timedelta(seconds=1)
    with sqlite_session_factory.begin() as session:
        session.add(next_row)
        session.flush()
        next_id = next_row.id

    queries = ConversationVariableRepository(session_factory=sqlite_session_factory)
    first = queries.get_page(ref=ref, last_id=None, limit=1, variable_name=None)
    assert first.data[0].id == row.id
    assert str(UUID(first.data[0].id)) == row.id
    assert first.has_more is True
    second = queries.get_page(ref=ref, last_id=first.data[0].id, limit=1, variable_name=None)
    assert [record.id for record in second.data] == [next_id]
    assert second.has_more is False

    result = commands.update_value(ref=ref, variable_id=first.data[0].id, new_value="updated")
    assert result.id == row.id
    assert result.variable.id == "imported-topic"
    assert result.variable.value == "updated"
    with sqlite_session_factory() as session:
        assert session.get_one(ConversationVariable, (row.id, ref.conversation_id)).to_variable() == result.variable


@pytest.mark.parametrize(
    ("value_type", "original", "invalid"),
    [
        ("string", "original", 42),
        ("string", "original", None),
        ("integer", 1, "wrong"),
        ("float", 1.5, "wrong"),
        ("boolean", True, "wrong"),
        ("object", {}, []),
        ("array[string]", ["original"], ["valid", 42]),
    ],
)
def test_type_mismatch_keeps_persisted_value_and_reports_expected_type(
    sqlite_session_factory: sessionmaker[Session],
    ref: EndUserConversationRef,
    commands: ConversationVariableCommandService,
    value_type: str,
    original: JsonValue,
    invalid: JsonValue,
) -> None:
    row = _seed_variable(
        sqlite_session_factory, ref=ref, value_type=value_type, value=original, logical_id=str(uuid4())
    )
    expected_type = "number" if value_type == "integer" else value_type
    with pytest.raises(ConversationVariableTypeMismatchError) as raised:
        commands.update_value(ref=ref, variable_id=row.id, new_value=invalid)
    assert f"variable 'topic' expects {expected_type}" in str(raised.value)
    assert "but got" in str(raised.value)
    with sqlite_session_factory() as session:
        assert session.get_one(ConversationVariable, (row.id, ref.conversation_id)).data == row.data


def test_factory_size_limit_rejects_update_without_writing(
    sqlite_session_factory: sessionmaker[Session],
    ref: EndUserConversationRef,
    commands: ConversationVariableCommandService,
) -> None:
    row = _seed_variable(
        sqlite_session_factory, ref=ref, value_type="string", value="original", logical_id=str(uuid4())
    )
    with pytest.raises(VariableError, match="exceeds limit"):
        commands.update_value(ref=ref, variable_id=row.id, new_value="x" * (dify_config.MAX_VARIABLE_SIZE + 1))
    with sqlite_session_factory() as session:
        assert session.get_one(ConversationVariable, (row.id, ref.conversation_id)).data == row.data


def test_missing_variable_raises_domain_error(
    ref: EndUserConversationRef, commands: ConversationVariableCommandService
) -> None:
    with pytest.raises(ConversationVariableNotExistsError):
        commands.update_value(ref=ref, variable_id=str(uuid4()), new_value="value")
