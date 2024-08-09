from collections.abc import Sequence
from enum import Enum
from typing import Optional, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.segments import SegmentType, Variable, factory
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from extensions.ext_database import db
from models import ConversationVariable, WorkflowNodeExecutionStatus


class VariableAssignerNodeError(Exception):
    pass


class WriteMode(str, Enum):
    OVER_WRITE = 'over-write'
    APPEND = 'append'
    CLEAR = 'clear'


class VariableAssignerData(BaseNodeData):
    title: str = 'Variable Assigner'
    desc: Optional[str] = 'Assign a value to a variable'
    assigned_variable_selector: Sequence[str]
    write_mode: WriteMode
    input_variable_selector: Sequence[str]


class VariableAssignerNode(BaseNode):
    _node_data_cls: type[BaseNodeData] = VariableAssignerData
    _node_type: NodeType = NodeType.CONVERSATION_VARIABLE_ASSIGNER

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        data = cast(VariableAssignerData, self.node_data)

        # Should be String, Number, Object, ArrayString, ArrayNumber, ArrayObject
        original_variable = variable_pool.get(data.assigned_variable_selector)
        if not isinstance(original_variable, Variable):
            raise VariableAssignerNodeError('assigned variable not found')

        match data.write_mode:
            case WriteMode.OVER_WRITE:
                income_value = variable_pool.get(data.input_variable_selector)
                if not income_value:
                    raise VariableAssignerNodeError('input value not found')
                updated_variable = original_variable.model_copy(update={'value': income_value.value})

            case WriteMode.APPEND:
                income_value = variable_pool.get(data.input_variable_selector)
                if not income_value:
                    raise VariableAssignerNodeError('input value not found')
                updated_value = original_variable.value + [income_value.value]
                updated_variable = original_variable.model_copy(update={'value': updated_value})

            case WriteMode.CLEAR:
                income_value = get_zero_value(original_variable.value_type)
                updated_variable = original_variable.model_copy(update={'value': income_value.to_object()})

            case _:
                raise VariableAssignerNodeError(f'unsupported write mode: {data.write_mode}')

        # Over write the variable.
        variable_pool.add(data.assigned_variable_selector, updated_variable)

        # Update conversation variable.
        # TODO: Find a better way to use the database.
        conversation_id = variable_pool.get(['sys', 'conversation_id'])
        if not conversation_id:
            raise VariableAssignerNodeError('conversation_id not found')
        update_conversation_variable(conversation_id=conversation_id.text, variable=updated_variable)

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={
                'value': income_value.to_object(),
            },
        )


def update_conversation_variable(conversation_id: str, variable: Variable):
    stmt = select(ConversationVariable).where(
        ConversationVariable.id == variable.id, ConversationVariable.conversation_id == conversation_id
    )
    with Session(db.engine) as session:
        row = session.scalar(stmt)
        if not row:
            raise VariableAssignerNodeError('conversation variable not found in the database')
        row.data = variable.model_dump_json()
        session.commit()


def get_zero_value(t: SegmentType):
    match t:
        case SegmentType.ARRAY_OBJECT | SegmentType.ARRAY_STRING | SegmentType.ARRAY_NUMBER:
            return factory.build_segment([])
        case SegmentType.OBJECT:
            return factory.build_segment({})
        case SegmentType.STRING:
            return factory.build_segment('')
        case SegmentType.NUMBER:
            return factory.build_segment(0)
        case _:
            raise VariableAssignerNodeError(f'unsupported variable type: {t}')
