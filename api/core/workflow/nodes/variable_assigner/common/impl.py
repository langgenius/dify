from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from core.variables.variables import Variable
from models.engine import db
from models.workflow import ConversationVariable

from .exc import VariableOperatorNodeError


class ConversationVariableUpdaterImpl:
    _engine: Engine | None

    def __init__(self, engine: Engine | None = None):
        self._engine = engine

    def _get_engine(self) -> Engine:
        if self._engine:
            return self._engine
        return db.engine

    def update(self, conversation_id: str, variable: Variable):
        stmt = select(ConversationVariable).where(
            ConversationVariable.id == variable.id, ConversationVariable.conversation_id == conversation_id
        )
        with Session(self._get_engine()) as session:
            row = session.scalar(stmt)
            if not row:
                raise VariableOperatorNodeError("conversation variable not found in the database")
            row.data = variable.model_dump_json()
            session.commit()

    def flush(self):
        pass


def conversation_variable_updater_factory() -> ConversationVariableUpdaterImpl:
    return ConversationVariableUpdaterImpl()
