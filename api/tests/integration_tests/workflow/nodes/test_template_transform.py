import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import UserFrom
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode
from models.workflow import WorkflowNodeExecutionStatus
from tests.integration_tests.workflow.nodes.__mock.code_executor import setup_code_executor_mock


@pytest.mark.parametrize('setup_code_executor_mock', [['none']], indirect=True)
def test_execute_code(setup_code_executor_mock):
    code = '''{{args2}}'''
    node = TemplateTransformNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.END_USER,
        config={
            'id': '1',
            'data': {
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
                'template': code,
            }
        }
    )

    # construct variable pool
    pool = VariablePool(system_variables={}, user_inputs={}, environment_variables=[])
    pool.add(['1', '123', 'args1'], 1)
    pool.add(['1', '123', 'args2'], 3)
    
    # execute node
    result = node.run(pool)
    
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs['output'] == '3'
