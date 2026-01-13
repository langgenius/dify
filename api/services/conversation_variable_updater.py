from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.variables.variables import VariableBase
from models import ConversationVariable


class ConversationVariableNotFoundError(Exception):
    pass


class ConversationVariableUpdater:
    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker: sessionmaker[Session] = session_maker

    def update(self, conversation_id: str, variable: VariableBase) -> None:
        stmt = select(ConversationVariable).where(
            ConversationVariable.id == variable.id, ConversationVariable.conversation_id == conversation_id
        )
        with self._session_maker() as session:
            row = session.scalar(stmt)
            if not row:
                raise ConversationVariableNotFoundError("conversation variable not found in the database")
            row.data = variable.model_dump_json()
            session.commit()

    def flush(self) -> None:
        pass
