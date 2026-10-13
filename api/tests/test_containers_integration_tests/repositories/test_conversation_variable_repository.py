"""Execute conversation-variable JSON filtering and writes against PostgreSQL."""

from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from factories import variable_factory
from models import App, AppMode, ConversationVariable
from models.enums import ConversationFromSource, EndUserType
from models.model import Conversation, EndUser
from repositories.conversation_variable_repository import ConversationVariableRepository
from services.conversation_variable_command_service import ConversationVariableCommandService
from services.entities.conversation_entities import EndUserConversationRef
from services.errors.conversation import ConversationVariableNotExistsError


def test_postgres_filters_text_json_paginates_and_updates_with_row_lock(
    db_session_with_containers: Session,
) -> None:
    engine = db_session_with_containers.get_bind()
    assert engine.dialect.name == "postgresql"
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    ref = EndUserConversationRef(
        app_id=str(uuid4()),
        tenant_id=str(uuid4()),
        end_user_id=str(uuid4()),
        conversation_id=str(uuid4()),
    )
    created_at = datetime(2020, 1, 1)
    rows: list[ConversationVariable] = []
    with sessions.begin() as session:
        session.add(
            App(
                id=ref.app_id,
                tenant_id=ref.tenant_id,
                name="Conversation variable integration test",
                mode=AppMode.ADVANCED_CHAT,
                enable_site=True,
                enable_api=True,
            )
        )
        session.add(
            EndUser(
                id=ref.end_user_id,
                tenant_id=ref.tenant_id,
                app_id=ref.app_id,
                type=EndUserType.SERVICE_API,
                session_id="conversation-variable-test",
            )
        )
        session.add(
            Conversation(
                id=ref.conversation_id,
                app_id=ref.app_id,
                mode=AppMode.ADVANCED_CHAT,
                name="Test conversation",
                inputs={},
                from_source=ConversationFromSource.API,
                from_end_user_id=ref.end_user_id,
                from_account_id=None,
                is_deleted=False,
            )
        )
        # Keep a nonmatching row between results to exercise filtering during pagination.
        for index, name in enumerate(("Profile_%\\First", "ProfileXunescaped", "PROFILE_%\\Second")):
            variable = variable_factory.build_conversation_variable_from_mapping(
                {
                    "id": f"imported-variable-{index}",
                    "name": name,
                    "value_type": "string",
                    "value": "original",
                    "description": "Keep this metadata",
                }
            )
            row = ConversationVariable.from_variable(
                app_id=ref.app_id, conversation_id=ref.conversation_id, variable=variable
            )
            row.created_at = created_at + timedelta(seconds=index)
            row.updated_at = row.created_at
            rows.append(row)
            session.add(row)

    repository = ConversationVariableRepository(session_factory=sessions)
    first = repository.get_page(ref=ref, last_id=None, limit=1, variable_name="profile_%\\")
    assert [record.id for record in first.data] == [rows[0].id]
    assert first.limit == 1
    assert first.has_more is True
    assert first.data[0].variable.id == "imported-variable-0"
    assert str(UUID(first.data[0].id)) == rows[0].id

    second = repository.get_page(ref=ref, last_id=first.data[0].id, limit=1, variable_name="profile_%\\")
    assert [record.id for record in second.data] == [rows[2].id]
    assert second.has_more is False
    with pytest.raises(ConversationVariableNotExistsError):
        repository.get_page(ref=ref, last_id=rows[1].id, limit=1, variable_name="profile_%\\")

    updated = ConversationVariableCommandService(variables=repository).update_value(
        ref=ref, variable_id=first.data[0].id, new_value="updated"
    )
    assert updated.id == rows[0].id
    assert updated.variable.value == "updated"
    assert updated.variable.model_dump(exclude={"value"}) == first.data[0].variable.model_dump(exclude={"value"})
    assert updated.created_at == created_at
    assert updated.updated_at > created_at

    # A separate session proves the FOR UPDATE transaction committed its changes.
    with sessions() as session:
        stored = session.get_one(ConversationVariable, (updated.id, ref.conversation_id))
        untouched = session.get_one(ConversationVariable, (rows[2].id, ref.conversation_id))
        assert stored.to_variable() == updated.variable
        assert stored.created_at == updated.created_at
        assert stored.updated_at == updated.updated_at
        assert untouched.to_variable().value == "original"
