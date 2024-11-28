from sqlalchemy import select
from sqlalchemy.orm import Session

from core.variables import Variable
from core.workflow.nodes.variable_assigner.common.exc import VariableOperatorNodeError
from extensions.ext_database import db
from models import ConversationVariable


def update_conversation_variable(conversation_id: str, variable: Variable):
    stmt = select(ConversationVariable).where(
        ConversationVariable.id == variable.id, ConversationVariable.conversation_id == conversation_id
    )
    with Session(db.engine) as session:
        row = session.scalar(stmt)
        if not row:
            raise VariableOperatorNodeError("conversation variable not found in the database")
        row.data = variable.model_dump_json()
        session.commit()
