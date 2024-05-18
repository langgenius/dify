from unittest.mock import MagicMock

from core.workflow.entities.node_entities import SystemVariable
from core.workflow.entities.variable_pool import VariablePool
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
    }, user_inputs={})
    pool.append_variable(node_id='start', variable_key_list=['weather'], value='sunny')
    pool.append_variable(node_id='llm', variable_key_list=['text'], value='You are a helpful AI.')

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs['answer'] == "Today's weather is sunny\nYou are a helpful AI.\n{{img}}\nFin."
