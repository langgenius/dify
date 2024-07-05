from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import SystemVariable
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import UserFrom
from core.workflow.nodes.if_else.if_else_node import IfElseNode
from extensions.ext_database import db
from models.workflow import WorkflowNodeExecutionStatus


def test_if_elif_else_result_true():
    node = IfElseNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        config={
            'id': 'if-else',
            'data': {
                'title': '123',
                'type': 'if-else',
                'cases': [
                    {
                        'logical_operator': 'and',
                        'conditions': [
                            {
                                'comparison_operator': 'is',
                                'variable_selector': ['start', 'is'],
                                'value': 'ab'
                            }
                        ]
                    },
                    {
                        'logical_operator': 'or',
                        'conditions': [
                            {
                                'comparison_operator': 'contains',
                                'variable_selector': ['start', 'contains'],
                                'value': 'ab'
                            },
                            {
                                'comparison_operator': 'not empty',
                                'variable_selector': ['start', 'not_empty'],
                                'value': 'ab'
                            }
                        ]
                    }
                ]
            }
        }
    )

    # Construct variable pool with values that will satisfy the second group (elseif)
    pool = VariablePool(system_variables={
        SystemVariable.FILES: [],
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={})
    pool.append_variable(node_id='start', variable_key_list=['is'], value='not_ab')  # Not satisfying first case
    pool.append_variable(node_id='start', variable_key_list=['contains'], value='abcde')  # Satisfying second case
    pool.append_variable(node_id='start', variable_key_list=['not_empty'], value='abcde')  # Satisfying second case

    # Mock db.session.close()
    db.session.close = MagicMock()

    # Execute node
    result = node._run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs['result'] is True, "The elseif condition should evaluate to True"


def test_execute_if_else_result_all_false():
    node = IfElseNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        config={
            'id': 'if-else',
            'data': {
                'title': '123',
                'type': 'if-else',
                'logical_operator': 'and',
                'conditions': [
                    {
                        'comparison_operator': 'contains',
                        'variable_selector': ['start', 'contains'],
                        'value': 'xyz'
                    },
                    {
                        'comparison_operator': 'is',
                        'variable_selector': ['start', 'is'],
                        'value': 'xyz'
                    }
                ]
            }
        }
    )

    # construct variable pool with values that do not satisfy any condition
    pool = VariablePool(system_variables={
        SystemVariable.FILES: [],
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={})
    pool.append_variable(node_id='start', variable_key_list=['contains'], value='abc')
    pool.append_variable(node_id='start', variable_key_list=['is'], value='abc')

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert not result.outputs['result'], "No conditions are met, the result should be False"
