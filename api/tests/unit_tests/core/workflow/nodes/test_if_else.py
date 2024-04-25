from unittest.mock import MagicMock

from core.workflow.entities.node_entities import SystemVariable
from core.workflow.entities.variable_pool import VariablePool
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
        SystemVariable.FILES: [],
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={})
    pool.append_variable(node_id='start', variable_key_list=['array_contains'], value=['ab', 'def'])
    pool.append_variable(node_id='start', variable_key_list=['array_not_contains'], value=['ac', 'def'])
    pool.append_variable(node_id='start', variable_key_list=['contains'], value='cabcde')
    pool.append_variable(node_id='start', variable_key_list=['not_contains'], value='zacde')
    pool.append_variable(node_id='start', variable_key_list=['start_with'], value='abc')
    pool.append_variable(node_id='start', variable_key_list=['end_with'], value='zzab')
    pool.append_variable(node_id='start', variable_key_list=['is'], value='ab')
    pool.append_variable(node_id='start', variable_key_list=['is_not'], value='aab')
    pool.append_variable(node_id='start', variable_key_list=['empty'], value='')
    pool.append_variable(node_id='start', variable_key_list=['not_empty'], value='aaa')
    pool.append_variable(node_id='start', variable_key_list=['equals'], value=22)
    pool.append_variable(node_id='start', variable_key_list=['not_equals'], value=23)
    pool.append_variable(node_id='start', variable_key_list=['greater_than'], value=23)
    pool.append_variable(node_id='start', variable_key_list=['less_than'], value=21)
    pool.append_variable(node_id='start', variable_key_list=['greater_than_or_equal'], value=22)
    pool.append_variable(node_id='start', variable_key_list=['less_than_or_equal'], value=21)
    pool.append_variable(node_id='start', variable_key_list=['not_null'], value='1212')

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
        SystemVariable.FILES: [],
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={})
    pool.append_variable(node_id='start', variable_key_list=['array_contains'], value=['1ab', 'def'])
    pool.append_variable(node_id='start', variable_key_list=['array_not_contains'], value=['ab', 'def'])

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs['result'] is False
