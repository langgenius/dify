from collections.abc import Sequence
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from graphon.variables import Variable
from graphon.variables.variables import VariableBase
from models import ConversationVariable
from models.model import Conversation


class ConversationVariableNotFoundError(Exception):
    pass


class WorkflowConversationVariableRepository:
    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker: sessionmaker[Session] = session_maker

    def initialize(self, *, app_id: str, conversation_id: str, defaults: Sequence[VariableBase]) -> list[Variable]:
        with self._session_maker.begin() as session:
            conversation = session.scalar(
                select(Conversation.id)
                .where(Conversation.id == conversation_id, Conversation.app_id == app_id)
                .with_for_update()
            )
            if conversation is None:
                raise ConversationVariableNotFoundError("Conversation not found")
            rows = list(
                session.scalars(
                    select(ConversationVariable).where(
                        ConversationVariable.app_id == app_id,
                        ConversationVariable.conversation_id == conversation_id,
                    )
                )
            )
            present = {row.id for row in rows}
            for variable in defaults:
                key = ConversationVariable.storage_id(variable)
                if key not in present:
                    row = ConversationVariable.from_variable(
                        app_id=app_id, conversation_id=conversation_id, variable=variable
                    )
                    session.add(row)
                    rows.append(row)
                    present.add(key)
            return [cast(Variable, row.to_variable()) for row in rows]

    def update(self, conversation_id: str, variable: VariableBase) -> None:
        stmt = select(ConversationVariable).where(
            ConversationVariable.id == ConversationVariable.storage_id(variable),
            ConversationVariable.conversation_id == conversation_id,
        )
        with self._session_maker() as session:
            row = session.scalar(stmt)
            if not row:
                raise ConversationVariableNotFoundError("conversation variable not found in the database")
            row.data = variable.model_dump_json()
            session.commit()
