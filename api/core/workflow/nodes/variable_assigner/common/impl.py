from sqlalchemy import select

from core.variables.variables import Variable
from models import ConversationVariable
from models.engine import Session

from .exc import VariableOperatorNodeError


class ConversationVariableUpdaterImpl:
    def update(self, conversation_id: str, variable: Variable):
        stmt = select(ConversationVariable).where(
            ConversationVariable.id == variable.id, ConversationVariable.conversation_id == conversation_id
        )
        with Session() as session:
            row = session.scalar(stmt)
            if not row:
                raise VariableOperatorNodeError("conversation variable not found in the database")
            row.data = variable.model_dump_json()
            session.commit()

    def flush(self):
        pass


def conversation_variable_updater_factory() -> ConversationVariableUpdaterImpl:
    return ConversationVariableUpdaterImpl()
