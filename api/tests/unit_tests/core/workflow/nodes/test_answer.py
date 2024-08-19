from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariable
from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.base_node import UserFrom
from extensions.ext_database import db
from models.workflow import WorkflowNodeExecutionStatus


def test_execute_answer():
    node = AnswerNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        config={
            'id': 'answer',
            'data': {
                'title': '123',
                'type': 'answer',
                'answer': 'Today\'s weather is {{#start.weather#}}\n{{#llm.text#}}\n{{img}}\nFin.'
            }
        }
    )

    # construct variable pool
    pool = VariablePool(system_variables={
        SystemVariable.FILES: [],
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={}, environment_variables=[])
    pool.add(['start', 'weather'], 'sunny')
    pool.add(['llm', 'text'], 'You are a helpful AI.')

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs['answer'] == "Today's weather is sunny\nYou are a helpful AI.\n{{img}}\nFin."
