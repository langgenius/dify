from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from graphon.variables.variables import VariableBase
from models import App, ConversationVariable
from repositories.workflow.upload_file_references import lock_new_workflow_upload_file_references


class ConversationVariableNotFoundError(Exception):
    pass


class ConversationVariableUpdater:
    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker: sessionmaker[Session] = session_maker

    def update(self, conversation_id: str, variable: VariableBase) -> None:
        stmt = (
            select(ConversationVariable)
            .where(
                ConversationVariable.id == ConversationVariable.storage_id(variable),
                ConversationVariable.conversation_id == conversation_id,
            )
            .with_for_update()
        )
        with self._session_maker() as session:
            row = session.scalar(stmt)
            if not row:
                raise ConversationVariableNotFoundError("conversation variable not found in the database")
            app = session.get(App, row.app_id)
            if app is None:
                raise ConversationVariableNotFoundError("conversation variable app not found in the database")
            serialized_variable = variable.model_dump_json()
            lock_new_workflow_upload_file_references(
                session,
                tenant_id=app.tenant_id,
                previous_payloads=(row.data,),
                current_payloads=(serialized_variable,),
            )
            row.data = serialized_variable
            session.commit()

    def flush(self) -> None:
        pass
