"""Conversation defaults are initialized once in the repository's own transaction."""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from factories import variable_factory
from models import Conversation, ConversationVariable
from repositories.workflow.conversation_variable_repository import WorkflowConversationVariableRepository

APP_ID = "11111111-1111-1111-1111-111111111111"
CONVERSATION_ID = "22222222-2222-2222-2222-222222222222"


def variable(identifier: str, name: str, value: str):
    return variable_factory.build_conversation_variable_from_mapping(
        {"id": identifier, "name": name, "value_type": "string", "value": value}
    )


@pytest.mark.parametrize("existing", [0, 1, 2])
def test_initialize_preserves_existing_values_and_adds_missing_defaults(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], existing: int
):
    defaults = [
        variable("33333333-3333-3333-3333-333333333333", "first", "default"),
        variable("33333333-3333-3333-3333-333333333334", "second", "default"),
    ]
    sqlite_session.add(
        Conversation(id=CONVERSATION_ID, app_id=APP_ID, mode="advanced-chat", name="test", inputs={}, from_source="api")
    )
    for item in defaults[:existing]:
        sqlite_session.add(
            ConversationVariable.from_variable(
                app_id=APP_ID, conversation_id=CONVERSATION_ID, variable=variable(item.id, item.name, "edited")
            )
        )
    sqlite_session.commit()
    repository = WorkflowConversationVariableRepository(sqlite_session_factory)
    result = repository.initialize(app_id=APP_ID, conversation_id=CONVERSATION_ID, defaults=defaults)
    assert {item.id: item.value for item in result} == {
        item.id: "edited" if i < existing else "default" for i, item in enumerate(defaults)
    }
    again = repository.initialize(app_id=APP_ID, conversation_id=CONVERSATION_ID, defaults=defaults)
    assert {item.id: item.value for item in again} == {item.id: item.value for item in result}
    assert len(sqlite_session.scalars(select(ConversationVariable)).all()) == 2


def test_non_uuid_variable_is_created_once(sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]):
    item = variable("opt-comp-prompt-var", "comparison_prompt", "-")
    sqlite_session.add(
        Conversation(id=CONVERSATION_ID, app_id=APP_ID, mode="advanced-chat", name="test", inputs={}, from_source="api")
    )
    sqlite_session.commit()
    repository = WorkflowConversationVariableRepository(sqlite_session_factory)
    for _ in range(2):
        result = repository.initialize(app_id=APP_ID, conversation_id=CONVERSATION_ID, defaults=[item])
        assert result[0].id == item.id
    stored = sqlite_session.scalars(select(ConversationVariable)).all()
    assert [row.id for row in stored] == [ConversationVariable.storage_id(item)]
