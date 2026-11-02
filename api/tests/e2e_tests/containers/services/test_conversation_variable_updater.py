"""Testcontainers integration tests for WorkflowConversationVariableRepository."""

from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from graphon.variables import StringVariable
from models.workflow import ConversationVariable
from repositories.workflow.conversation_variable_repository import (
    ConversationVariableNotFoundError,
    WorkflowConversationVariableRepository,
)


class TestWorkflowConversationVariableRepository:
    def _create_conversation_variable(
        self,
        db_session_with_containers: Session,
        *,
        conversation_id: str,
        variable: StringVariable,
        app_id: str | None = None,
    ) -> ConversationVariable:
        row = ConversationVariable(
            id=variable.id,
            conversation_id=conversation_id,
            app_id=app_id or str(uuid4()),
            data=variable.model_dump_json(),
        )
        db_session_with_containers.add(row)
        db_session_with_containers.commit()
        return row

    def test_should_update_conversation_variable_data_and_commit(self, db_session_with_containers: Session):
        conversation_id = str(uuid4())
        variable = StringVariable(id=str(uuid4()), name="topic", value="old value")
        self._create_conversation_variable(
            db_session_with_containers, conversation_id=conversation_id, variable=variable
        )

        updated_variable = StringVariable(id=variable.id, name="topic", value="new value")
        updater = WorkflowConversationVariableRepository(sessionmaker(bind=db.engine))

        updater.update(conversation_id=conversation_id, variable=updated_variable)

        db_session_with_containers.expire_all()
        row = db_session_with_containers.get(ConversationVariable, (variable.id, conversation_id))
        assert row is not None
        assert row.data == updated_variable.model_dump_json()

    def test_should_raise_not_found_when_variable_missing(self, db_session_with_containers: Session):
        conversation_id = str(uuid4())
        variable = StringVariable(id=str(uuid4()), name="topic", value="value")
        updater = WorkflowConversationVariableRepository(sessionmaker(bind=db.engine))

        with pytest.raises(ConversationVariableNotFoundError, match="conversation variable not found in the database"):
            updater.update(conversation_id=conversation_id, variable=variable)
