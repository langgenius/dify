from unittest.mock import MagicMock

from core.workflow.entities.node_entities import SystemVariable
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.base_node import UserFrom
from core.workflow.nodes.if_else.if_else_node import IfElseNode
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
                'variables': [
                    {
                        'value_selector': ['llm', 'text'],
                        'variable': 'text'
                    },
                    {
                        'value_selector': ['start', 'weather'],
                        'variable': 'weather'
                    },
                ],
                'answer': 'Today\'s weather is {{weather}}\n{{text}}\n{{img}}\nFin.'
            }
        }
    )

    # construct variable pool
    pool = VariablePool(system_variables={
        SystemVariable.FILES: [],
    }, user_inputs={})
    pool.append_variable(node_id='start', variable_key_list=['weather'], value='sunny')
    pool.append_variable(node_id='llm', variable_key_list=['text'], value='You are a helpful AI.')

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs['answer'] == "Today's weather is sunny\nYou are a helpful AI.\n{{img}}\nFin."


# TODO test files
