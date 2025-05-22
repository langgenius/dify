from collections.abc import Sequence
from typing import Any, TypedDict

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.variables import Segment, SegmentType, Variable
from core.variables.consts import MIN_SELECTORS_LENGTH
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


class VariableOutput(TypedDict):
    name: str
    selector: Sequence[str]
    new_value: Any
    type: SegmentType


def variable_to_output_mapping(selector: Sequence[str], seg: Segment) -> VariableOutput:
    if len(selector) < MIN_SELECTORS_LENGTH:
        raise Exception("selector too short")
    node_id, var_name = selector[:2]
    return {
        "name": var_name,
        "selector": selector[:2],
        "new_value": seg.value,
        "type": seg.value_type,
    }
