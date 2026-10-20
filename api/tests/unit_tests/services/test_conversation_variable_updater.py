import pytest
from sqlalchemy.orm import Session, sessionmaker

from graphon.variables import StringVariable
from models import ConversationVariable
from services.conversation_variable_updater import ConversationVariableUpdater


@pytest.mark.parametrize("sqlite_session", [(ConversationVariable,)], indirect=True)
@pytest.mark.parametrize("variable_id", ["imported-topic", "33333333-3333-3333-3333-333333333333"])
def test_runtime_update_preserves_authored_id_and_other_conversations(
    sqlite_session: Session, variable_id: str
) -> None:
    variable = StringVariable(id=variable_id, name="topic", value="original", selector=["conversation", "topic"])
    conversation_id = "22222222-2222-2222-2222-222222222222"
    other_conversation_id = "22222222-2222-2222-2222-222222222223"
    rows = [
        ConversationVariable.from_variable(
            app_id="11111111-1111-1111-1111-111111111111",
            conversation_id=owner,
            variable=variable,
        )
        for owner in (conversation_id, other_conversation_id)
    ]
    sqlite_session.add_all(rows)
    sqlite_session.commit()
    updater = ConversationVariableUpdater(sessionmaker(bind=sqlite_session.get_bind()))

    updater.update(conversation_id, variable.model_copy(update={"value": "updated"}))

    sqlite_session.expire_all()
    assert rows[0].to_variable().id == variable_id
    assert rows[0].to_variable().value == "updated"
    assert rows[1].to_variable().value == "original"
