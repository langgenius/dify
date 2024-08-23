from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes.base_node import UserFrom
from core.workflow.nodes.if_else.if_else_node import IfElseNode
from extensions.ext_database import db
from models.workflow import WorkflowNodeExecutionStatus


def test_execute_if_else_result_true():
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
                        'variable_selector': ['start', 'array_contains'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': 'not contains',
                        'variable_selector': ['start', 'array_not_contains'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': 'contains',
                        'variable_selector': ['start', 'contains'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': 'not contains',
                        'variable_selector': ['start', 'not_contains'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': 'start with',
                        'variable_selector': ['start', 'start_with'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': 'end with',
                        'variable_selector': ['start', 'end_with'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': 'is',
                        'variable_selector': ['start', 'is'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': 'is not',
                        'variable_selector': ['start', 'is_not'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': 'empty',
                        'variable_selector': ['start', 'empty'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': 'not empty',
                        'variable_selector': ['start', 'not_empty'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': '=',
                        'variable_selector': ['start', 'equals'],
                        'value': '22'
                    },
                    {
                        'comparison_operator': '≠',
                        'variable_selector': ['start', 'not_equals'],
                        'value': '22'
                    },
                    {
                        'comparison_operator': '>',
                        'variable_selector': ['start', 'greater_than'],
                        'value': '22'
                    },
                    {
                        'comparison_operator': '<',
                        'variable_selector': ['start', 'less_than'],
                        'value': '22'
                    },
                    {
                        'comparison_operator': '≥',
                        'variable_selector': ['start', 'greater_than_or_equal'],
                        'value': '22'
                    },
                    {
                        'comparison_operator': '≤',
                        'variable_selector': ['start', 'less_than_or_equal'],
                        'value': '22'
                    },
                    {
                        'comparison_operator': 'null',
                        'variable_selector': ['start', 'null']
                    },
                    {
                        'comparison_operator': 'not null',
                        'variable_selector': ['start', 'not_null']
                    },
                ]
            }
        }
    )

    # construct variable pool
    pool = VariablePool(system_variables={
        SystemVariableKey.FILES: [],
        SystemVariableKey.USER_ID: 'aaa'
    }, user_inputs={}, environment_variables=[])
    pool.add(['start', 'array_contains'], ['ab', 'def'])
    pool.add(['start', 'array_not_contains'], ['ac', 'def'])
    pool.add(['start', 'contains'], 'cabcde')
    pool.add(['start', 'not_contains'], 'zacde')
    pool.add(['start', 'start_with'], 'abc')
    pool.add(['start', 'end_with'], 'zzab')
    pool.add(['start', 'is'], 'ab')
    pool.add(['start', 'is_not'], 'aab')
    pool.add(['start', 'empty'], '')
    pool.add(['start', 'not_empty'], 'aaa')
    pool.add(['start', 'equals'], 22)
    pool.add(['start', 'not_equals'], 23)
    pool.add(['start', 'greater_than'], 23)
    pool.add(['start', 'less_than'], 21)
    pool.add(['start', 'greater_than_or_equal'], 22)
    pool.add(['start', 'less_than_or_equal'], 21)
    pool.add(['start', 'not_null'], '1212')

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs['result'] is True


def test_execute_if_else_result_false():
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
                'logical_operator': 'or',
                'conditions': [
                    {
                        'comparison_operator': 'contains',
                        'variable_selector': ['start', 'array_contains'],
                        'value': 'ab'
                    },
                    {
                        'comparison_operator': 'not contains',
                        'variable_selector': ['start', 'array_not_contains'],
                        'value': 'ab'
                    }
                ]
            }
        }
    )

    # construct variable pool
    pool = VariablePool(system_variables={
        SystemVariableKey.FILES: [],
        SystemVariableKey.USER_ID: 'aaa'
    }, user_inputs={}, environment_variables=[])
    pool.add(['start', 'array_contains'], ['1ab', 'def'])
    pool.add(['start', 'array_not_contains'], ['ab', 'def'])

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs['result'] is False
