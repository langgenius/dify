import pytest
from core.app.entities.app_invoke_entities import InvokeFrom

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.tool.tool_node import ToolNode
from models.workflow import WorkflowNodeExecutionStatus

"""
class ToolEntity(BaseModel):
    provider_id: str
    provider_type: Literal['builtin', 'api']
    provider_name: str # redundancy
    tool_name: str
    tool_label: str # redundancy
    tool_configurations: dict[str, ToolParameterValue]

class ToolNodeData(BaseNodeData, ToolEntity):
    class ToolInput(VariableSelector):
        variable_type: Literal['selector', 'static']
        value: Optional[str]

        @validator('value')
        def check_value(cls, value, values, **kwargs):
            if values['variable_type'] == 'static' and value is None:
                raise ValueError('value is required for static variable')
            return value
    
    tool_parameters: list[ToolInput]

"""

def test_tool_invoke():
    pool = VariablePool(system_variables={}, user_inputs={})
    pool.append_variable(node_id='1', variable_key_list=['123', 'args1'], value='1+1')

    node = ToolNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        user_from=InvokeFrom.WEB_APP,
        config={
            'id': '1',
            'data': {
                'title': 'a',
                'desc': 'a',
                'provider_id': 'maths',
                'provider_type': 'builtin',
                'provider_name': 'maths',
                'tool_name': 'eval_expression',
                'tool_label': 'eval_expression',
                'tool_configurations': {},
                'tool_parameters': [
                    {
                        'variable': 'expression',
                        'value_selector': ['1', '123', 'args1'],
                        'variable_type': 'selector',
                        'value': None
                    },
                ]
            }
        }
    )

    # execute node
    result = node.run(pool)
    
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert '2' in result.outputs['text']
    assert result.outputs['files'] == []