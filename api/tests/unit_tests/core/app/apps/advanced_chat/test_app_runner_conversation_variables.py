"""SQLite-backed conversation-variable synchronization tests for AdvancedChatAppRunner."""

from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.apps.advanced_chat import app_runner as app_runner_module
from core.app.apps.advanced_chat.app_runner import AdvancedChatAppRunner
from factories import variable_factory
from graphon.variables import SegmentType
from models import ConversationVariable

APP_ID = "11111111-1111-1111-1111-111111111111"
CONVERSATION_ID = "22222222-2222-2222-2222-222222222222"
OTHER_CONVERSATION_ID = "22222222-2222-2222-2222-222222222223"
VAR_1_ID = "33333333-3333-3333-3333-333333333333"
VAR_2_ID = "33333333-3333-3333-3333-333333333334"


def _variable(variable_id: str, name: str, value: str):
    return variable_factory.build_conversation_variable_from_mapping(
        {
            "id": variable_id,
            "name": name,
            "value_type": SegmentType.STRING,
            "value": value,
        }
    )


def _runner(workflow_variables: list[object]) -> AdvancedChatAppRunner:
    workflow = MagicMock()
    workflow.conversation_variables = workflow_variables
    conversation = MagicMock(app_id=APP_ID, id=CONVERSATION_ID)
    return AdvancedChatAppRunner(
        application_generate_entity=MagicMock(),
        queue_manager=MagicMock(),
        conversation=conversation,
        message=MagicMock(),
        dialogue_count=1,
        variable_loader=MagicMock(),
        workflow=workflow,
        system_user_id="44444444-4444-4444-4444-444444444444",
        app=MagicMock(),
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )


def _bind_runner_sessions(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    engine = sqlite_session.get_bind()
    monkeypatch.setattr(
        app_runner_module,
        "create_session",
        lambda: Session(engine, expire_on_commit=False),
    )


def _persist_variable(session: Session, *, variable: object, conversation_id: str = CONVERSATION_ID) -> None:
    session.add(
        ConversationVariable.from_variable(
            app_id=APP_ID,
            conversation_id=conversation_id,
            variable=variable,
        )
    )
    session.commit()


@pytest.mark.parametrize("sqlite_session", [(ConversationVariable,)], indirect=True)
def test_missing_conversation_variables_are_added(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    existing_variable = _variable(VAR_1_ID, "existing_var", "default1")
    new_variable = _variable(VAR_2_ID, "new_var", "default2")
    _persist_variable(sqlite_session, variable=existing_variable)
    _persist_variable(sqlite_session, variable=new_variable, conversation_id=OTHER_CONVERSATION_ID)
    _bind_runner_sessions(monkeypatch, sqlite_session)

    variables = _runner([existing_variable, new_variable])._initialize_conversation_variables()

    assert [variable.id for variable in variables] == [VAR_1_ID, VAR_2_ID]
    persisted = sqlite_session.scalars(
        select(ConversationVariable)
        .where(ConversationVariable.conversation_id == CONVERSATION_ID)
        .order_by(ConversationVariable.id)
    ).all()
    assert [variable.id for variable in persisted] == [VAR_1_ID, VAR_2_ID]


@pytest.mark.parametrize("sqlite_session", [(ConversationVariable,)], indirect=True)
def test_no_variables_creates_all(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    workflow_variables = [
        _variable(VAR_1_ID, "var1", "default1"),
        _variable(VAR_2_ID, "var2", "default2"),
    ]
    _bind_runner_sessions(monkeypatch, sqlite_session)

    variables = _runner(workflow_variables)._initialize_conversation_variables()

    assert [variable.id for variable in variables] == [VAR_1_ID, VAR_2_ID]
    persisted = sqlite_session.scalars(select(ConversationVariable).order_by(ConversationVariable.id)).all()
    assert [variable.id for variable in persisted] == [VAR_1_ID, VAR_2_ID]


@pytest.mark.parametrize("sqlite_session", [(ConversationVariable,)], indirect=True)
def test_all_variables_exist_no_changes(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    workflow_variables = [
        _variable(VAR_1_ID, "var1", "default1"),
        _variable(VAR_2_ID, "var2", "default2"),
    ]
    for variable in workflow_variables:
        _persist_variable(sqlite_session, variable=variable)
    _bind_runner_sessions(monkeypatch, sqlite_session)

    variables = _runner(workflow_variables)._initialize_conversation_variables()

    assert [variable.id for variable in variables] == [VAR_1_ID, VAR_2_ID]
    persisted = sqlite_session.scalars(select(ConversationVariable)).all()
    assert len(persisted) == 2
