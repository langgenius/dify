from os import getenv

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import UserFrom
from core.workflow.nodes.code.code_node import CodeNode
from models.workflow import WorkflowNodeExecutionStatus
from tests.integration_tests.workflow.nodes.__mock.code_executor import setup_code_executor_mock

CODE_MAX_STRING_LENGTH = int(getenv('CODE_MAX_STRING_LENGTH', '10000'))

@pytest.mark.parametrize('setup_code_executor_mock', [['none']], indirect=True)
def test_execute_code(setup_code_executor_mock):
    code = '''
    def main(args1: int, args2: int) -> dict:
        return {
            "result": args1 + args2,
        }
    '''
    # trim first 4 spaces at the beginning of each line
    code = '\n'.join([line[4:] for line in code.split('\n')])
    node = CodeNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        config={
            'id': '1',
            'data': {
                'outputs': {
                    'result': {
                        'type': 'number',
                    },
                },
                'title': '123',
                'variables': [
                    {
                        'variable': 'args1',
                        'value_selector': ['1', '123', 'args1'],
                    },
                    {
                        'variable': 'args2',
                        'value_selector': ['1', '123', 'args2']
                    }
                ],
                'answer': '123',
                'code_language': 'python3',
                'code': code
            }
        }
    )

    # construct variable pool
    pool = VariablePool(system_variables={}, user_inputs={})
    pool.append_variable(node_id='1', variable_key_list=['123', 'args1'], value=1)
    pool.append_variable(node_id='1', variable_key_list=['123', 'args2'], value=2)
    
    # execute node
    result = node.run(pool)
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs['result'] == 3
    assert result.error is None

@pytest.mark.parametrize('setup_code_executor_mock', [['none']], indirect=True)
def test_execute_code_output_validator(setup_code_executor_mock):
    code = '''
    def main(args1: int, args2: int) -> dict:
        return {
            "result": args1 + args2,
        }
    '''
    # trim first 4 spaces at the beginning of each line
    code = '\n'.join([line[4:] for line in code.split('\n')])
    node = CodeNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        config={
            'id': '1',
            'data': {
                "outputs": {
                    "result": {
                        "type": "string",
                    },
                },
                'title': '123',
                'variables': [
                    {
                        'variable': 'args1',
                        'value_selector': ['1', '123', 'args1'],
                    },
                    {
                        'variable': 'args2',
                        'value_selector': ['1', '123', 'args2']
                    }
                ],
                'answer': '123',
                'code_language': 'python3',
                'code': code
            }
        }
    )

    # construct variable pool
    pool = VariablePool(system_variables={}, user_inputs={})
    pool.append_variable(node_id='1', variable_key_list=['123', 'args1'], value=1)
    pool.append_variable(node_id='1', variable_key_list=['123', 'args2'], value=2)
    
    # execute node
    result = node.run(pool)

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == 'Output variable `result` must be a string'

def test_execute_code_output_validator_depth():
    code = '''
    def main(args1: int, args2: int) -> dict:
        return {
            "result": {
                "result": args1 + args2,
            }
        }
    '''
    # trim first 4 spaces at the beginning of each line
    code = '\n'.join([line[4:] for line in code.split('\n')])
    node = CodeNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        config={
            'id': '1',
            'data': {
                "outputs": {
                    "string_validator": {
                        "type": "string",
                    },
                    "number_validator": {
                        "type": "number",
                    },
                    "number_array_validator": {
                        "type": "array[number]",
                    },
                    "string_array_validator": {
                        "type": "array[string]",
                    },
                    "object_validator": {
                        "type": "object",
                        "children": {
                            "result": {
                                "type": "number",
                            },
                            "depth": {
                                "type": "object",
                                "children": {
                                    "depth": {
                                        "type": "object",
                                        "children": {
                                            "depth": {
                                                "type": "number",
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                },
                'title': '123',
                'variables': [
                    {
                        'variable': 'args1',
                        'value_selector': ['1', '123', 'args1'],
                    },
                    {
                        'variable': 'args2',
                        'value_selector': ['1', '123', 'args2']
                    }
                ],
                'answer': '123',
                'code_language': 'python3',
                'code': code
            }
        }
    )

    # construct result
    result = {
        "number_validator": 1,
        "string_validator": "1",
        "number_array_validator": [1, 2, 3, 3.333],
        "string_array_validator": ["1", "2", "3"],
        "object_validator": {
            "result": 1,
            "depth": {
                "depth": {
                    "depth": 1
                }
            }
        }
    }

    # validate
    node._transform_result(result, node.node_data.outputs)

    # construct result
    result = {
        "number_validator": "1",
        "string_validator": 1,
        "number_array_validator": ["1", "2", "3", "3.333"],
        "string_array_validator": [1, 2, 3],
        "object_validator": {
            "result": "1",
            "depth": {
                "depth": {
                    "depth": "1"
                }
            }
        }
    }

    # validate
    with pytest.raises(ValueError):
        node._transform_result(result, node.node_data.outputs)

    # construct result
    result = {
        "number_validator": 1,
        "string_validator": (CODE_MAX_STRING_LENGTH + 1) * "1",
        "number_array_validator": [1, 2, 3, 3.333],
        "string_array_validator": ["1", "2", "3"],
        "object_validator": {
            "result": 1,
            "depth": {
                "depth": {
                    "depth": 1
                }
            }
        }
    }

    # validate
    with pytest.raises(ValueError):
        node._transform_result(result, node.node_data.outputs)
    
    # construct result
    result = {
        "number_validator": 1,
        "string_validator": "1",
        "number_array_validator": [1, 2, 3, 3.333] * 2000,
        "string_array_validator": ["1", "2", "3"],
        "object_validator": {
            "result": 1,
            "depth": {
                "depth": {
                    "depth": 1
                }
            }
        }
    }

    # validate
    with pytest.raises(ValueError):
        node._transform_result(result, node.node_data.outputs)


def test_execute_code_output_object_list():
    code = '''
    def main(args1: int, args2: int) -> dict:
        return {
            "result": {
                "result": args1 + args2,
            }
        }
    '''
    # trim first 4 spaces at the beginning of each line
    code = '\n'.join([line[4:] for line in code.split('\n')])
    node = CodeNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.ACCOUNT,
        config={
            'id': '1',
            'data': {
                "outputs": {
                    "object_list": {
                        "type": "array[object]",
                    },
                },
                'title': '123',
                'variables': [
                    {
                        'variable': 'args1',
                        'value_selector': ['1', '123', 'args1'],
                    },
                    {
                        'variable': 'args2',
                        'value_selector': ['1', '123', 'args2']
                    }
                ],
                'answer': '123',
                'code_language': 'python3',
                'code': code
            }
        }
    )

    # construct result
    result = {
        "object_list": [{
            "result": 1,
        }, {
            "result": 2,
        }, {
            "result": [1, 2, 3],
        }]
    }

    # validate
    node._transform_result(result, node.node_data.outputs)

    # construct result
    result = {
        "object_list": [{
            "result": 1,
        }, {
            "result": 2,
        }, {
            "result": [1, 2, 3],
        }, 1]
    }

    # validate
    with pytest.raises(ValueError):
        node._transform_result(result, node.node_data.outputs)
