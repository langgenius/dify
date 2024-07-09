from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import SystemVariable
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import UserFrom
from core.workflow.nodes.if_else.if_else_node import IfElseNode
from extensions.ext_database import db
from models.workflow import WorkflowNodeExecutionStatus


def test_if_elif_result_true():
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
                "cases": [{
                    "id": "c88839c9-21a0-4d4f-985d-3b4fa070cabc",
                    "caseId": "c88839c9-21a0-4d4f-985d-3b4fa070cabc",
                    "logical_operator": "or",
                    "conditions": [{
                        "id": "56bb88df-7b83-4369-b203-0eadeda251e7",
                        "varType": "string",
                        "variable_selector": [
                            "1719988447278",
                            "query"
                        ],
                        "comparison_operator": "contains",
                        "value": "你好"
                    }]
                },
                    {
                        "caseId": "6ee12213-def4-42d2-baee-cc25d4ab70e8",
                        "logical_operator": "and",
                        "conditions": [{
                            "id": "501c675a-2410-4771-b5dc-ebbe92779c84",
                            "varType": "string",
                            "variable_selector": [
                                "1719988491297",
                                "class_name"
                            ],
                            "comparison_operator": "contains",
                            "value": "打招呼"
                        }]
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
    pool.append_variable(node_id='1719988447278', variable_key_list=['query'], value='你好')
    pool.append_variable(node_id='1719988491297', variable_key_list=['class_name'], value='打招呼')

    # Mock db.session.close()
    db.session.close = MagicMock()

    # Execute node
    result = node._run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs['result'] is True, "The elseif condition should evaluate to True"


