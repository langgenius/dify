import time
import uuid
from unittest.mock import MagicMock, Mock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.file import File, FileTransferMethod, FileType
from core.variables import ArrayFileSegment
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.if_else.entities import IfElseNodeData
from core.workflow.nodes.if_else.if_else_node import IfElseNode
from core.workflow.utils.condition.entities import Condition, SubCondition, SubVariableCondition
from extensions.ext_database import db
from models.enums import UserFrom
from models.workflow import WorkflowNodeExecutionStatus, WorkflowType


def test_execute_if_else_result_true():
    graph_config = {"edges": [], "nodes": [{"data": {"type": "start"}, "id": "start"}]}

    graph = Graph.init(graph_config=graph_config)

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    pool = VariablePool(
        system_variables={SystemVariableKey.FILES: [], SystemVariableKey.USER_ID: "aaa"}, user_inputs={}
    )
    pool.add(["start", "array_contains"], ["ab", "def"])
    pool.add(["start", "array_not_contains"], ["ac", "def"])
    pool.add(["start", "contains"], "cabcde")
    pool.add(["start", "not_contains"], "zacde")
    pool.add(["start", "start_with"], "abc")
    pool.add(["start", "end_with"], "zzab")
    pool.add(["start", "is"], "ab")
    pool.add(["start", "is_not"], "aab")
    pool.add(["start", "empty"], "")
    pool.add(["start", "not_empty"], "aaa")
    pool.add(["start", "equals"], 22)
    pool.add(["start", "not_equals"], 23)
    pool.add(["start", "greater_than"], 23)
    pool.add(["start", "less_than"], 21)
    pool.add(["start", "greater_than_or_equal"], 22)
    pool.add(["start", "less_than_or_equal"], 21)
    pool.add(["start", "null"], None)
    pool.add(["start", "not_null"], "1212")

    node = IfElseNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter()),
        config={
            "id": "if-else",
            "data": {
                "title": "123",
                "type": "if-else",
                "logical_operator": "and",
                "conditions": [
                    {
                        "comparison_operator": "contains",
                        "variable_selector": ["start", "array_contains"],
                        "value": "ab",
                    },
                    {
                        "comparison_operator": "not contains",
                        "variable_selector": ["start", "array_not_contains"],
                        "value": "ab",
                    },
                    {"comparison_operator": "contains", "variable_selector": ["start", "contains"], "value": "ab"},
                    {
                        "comparison_operator": "not contains",
                        "variable_selector": ["start", "not_contains"],
                        "value": "ab",
                    },
                    {"comparison_operator": "start with", "variable_selector": ["start", "start_with"], "value": "ab"},
                    {"comparison_operator": "end with", "variable_selector": ["start", "end_with"], "value": "ab"},
                    {"comparison_operator": "is", "variable_selector": ["start", "is"], "value": "ab"},
                    {"comparison_operator": "is not", "variable_selector": ["start", "is_not"], "value": "ab"},
                    {"comparison_operator": "empty", "variable_selector": ["start", "empty"], "value": "ab"},
                    {"comparison_operator": "not empty", "variable_selector": ["start", "not_empty"], "value": "ab"},
                    {"comparison_operator": "=", "variable_selector": ["start", "equals"], "value": "22"},
                    {"comparison_operator": "≠", "variable_selector": ["start", "not_equals"], "value": "22"},
                    {"comparison_operator": ">", "variable_selector": ["start", "greater_than"], "value": "22"},
                    {"comparison_operator": "<", "variable_selector": ["start", "less_than"], "value": "22"},
                    {
                        "comparison_operator": "≥",
                        "variable_selector": ["start", "greater_than_or_equal"],
                        "value": "22",
                    },
                    {"comparison_operator": "≤", "variable_selector": ["start", "less_than_or_equal"], "value": "22"},
                    {"comparison_operator": "null", "variable_selector": ["start", "null"]},
                    {"comparison_operator": "not null", "variable_selector": ["start", "not_null"]},
                ],
            },
        },
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is True


def test_execute_if_else_result_false():
    graph_config = {
        "edges": [
            {
                "id": "start-source-llm-target",
                "source": "start",
                "target": "llm",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    pool = VariablePool(
        system_variables={SystemVariableKey.FILES: [], SystemVariableKey.USER_ID: "aaa"},
        user_inputs={},
        environment_variables=[],
    )
    pool.add(["start", "array_contains"], ["1ab", "def"])
    pool.add(["start", "array_not_contains"], ["ab", "def"])

    node = IfElseNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter()),
        config={
            "id": "if-else",
            "data": {
                "title": "123",
                "type": "if-else",
                "logical_operator": "or",
                "conditions": [
                    {
                        "comparison_operator": "contains",
                        "variable_selector": ["start", "array_contains"],
                        "value": "ab",
                    },
                    {
                        "comparison_operator": "not contains",
                        "variable_selector": ["start", "array_not_contains"],
                        "value": "ab",
                    },
                ],
            },
        },
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is False


def test_array_file_contains_file_name():
    node_data = IfElseNodeData(
        title="123",
        logical_operator="and",
        cases=[
            IfElseNodeData.Case(
                case_id="true",
                logical_operator="and",
                conditions=[
                    Condition(
                        comparison_operator="contains",
                        variable_selector=["start", "array_contains"],
                        sub_variable_condition=SubVariableCondition(
                            logical_operator="and",
                            conditions=[
                                SubCondition(
                                    key="name",
                                    comparison_operator="contains",
                                    value="ab",
                                )
                            ],
                        ),
                    )
                ],
            )
        ],
    )

    node = IfElseNode(
        id=str(uuid.uuid4()),
        graph_init_params=Mock(),
        graph=Mock(),
        graph_runtime_state=Mock(),
        config={
            "id": "if-else",
            "data": node_data.model_dump(),
        },
    )

    node.graph_runtime_state.variable_pool.get.return_value = ArrayFileSegment(
        value=[
            File(
                tenant_id="1",
                type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                related_id="1",
                filename="ab",
            ),
        ],
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["result"] is True
