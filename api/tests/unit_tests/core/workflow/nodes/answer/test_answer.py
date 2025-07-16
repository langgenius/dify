import time
import uuid
from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.answer.answer_node import AnswerNode
from extensions.ext_database import db
from models.enums import UserFrom
from models.workflow import WorkflowType


def test_execute_answer():
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
    pool.add(["start", "weather"], "sunny")
    pool.add(["llm", "text"], "You are a helpful AI.")

    node = AnswerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter()),
        config={
            "id": "answer",
            "data": {
                "title": "123",
                "type": "answer",
                "answer": "Today's weather is {{#start.weather#}}\n{{#llm.text#}}\n{{img}}\nFin.",
                "outputs": [],
            },
        },
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["answer"] == "Today's weather is sunny\nYou are a helpful AI.\n{{img}}\nFin."


def test_execute_answer_with_outputs():
    """Test Answer node with custom output variables"""
    graph_config = {
        "edges": [
            {
                "id": "start-source-answer-target",
                "source": "start",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "title": "Answer with outputs",
                    "type": "answer",
                    "answer": "Weather: {{#start.weather#}}, Score: {{#start.score#}}",
                    "outputs": [
                        {"variable": "confidence", "type": "number", "value_selector": ["start", "score"]},
                        {"variable": "status", "type": "string", "value_selector": ["start", "weather"]},
                    ],
                },
                "id": "answer",
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
    variable_pool = VariablePool(
        system_variables={SystemVariableKey.FILES: [], SystemVariableKey.USER_ID: "aaa"},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["start", "weather"], "sunny")
    variable_pool.add(["start", "score"], 85)

    node = AnswerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config={
            "id": "answer",
            "data": {
                "title": "Answer with outputs",
                "type": "answer",
                "answer": "Weather: {{#start.weather#}}, Score: {{#start.score#}}",
                "outputs": [
                    {"variable": "confidence", "type": "number", "value_selector": ["start", "score"]},
                    {"variable": "status", "type": "string", "value_selector": ["start", "weather"]},
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
    assert result.outputs["answer"] == "Weather: sunny, Score: 85"

    # Check outputs field
    assert "outputs" in result.outputs
    outputs = result.outputs["outputs"]
    assert outputs["confidence"] == 85
    assert outputs["status"] == "sunny"


def test_execute_answer_with_complex_outputs():
    """Test Answer node with complex output variables including arrays and objects"""
    graph_config = {
        "edges": [
            {
                "id": "start-source-answer-target",
                "source": "start",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "title": "Complex outputs",
                    "type": "answer",
                    "answer": "Analysis complete",
                    "outputs": [
                        {"variable": "scores", "type": "array[number]", "value_selector": ["start", "score_list"]},
                        {"variable": "metadata", "type": "object", "value_selector": ["start", "meta_info"]},
                    ],
                },
                "id": "answer",
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

    # construct variable pool with complex data
    variable_pool = VariablePool(
        system_variables={SystemVariableKey.FILES: [], SystemVariableKey.USER_ID: "aaa"},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["start", "score_list"], [85, 92, 78])
    variable_pool.add(["start", "meta_info"], {"category": "test", "priority": "high"})

    node = AnswerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config={
            "id": "answer",
            "data": {
                "title": "Complex outputs",
                "type": "answer",
                "answer": "Analysis complete",
                "outputs": [
                    {"variable": "scores", "type": "array[number]", "value_selector": ["start", "score_list"]},
                    {"variable": "metadata", "type": "object", "value_selector": ["start", "meta_info"]},
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
    assert result.outputs["answer"] == "Analysis complete"

    # Check complex outputs
    assert "outputs" in result.outputs
    outputs = result.outputs["outputs"]
    assert outputs["scores"] == [85, 92, 78]
    assert outputs["metadata"] == {"category": "test", "priority": "high"}


def test_execute_answer_with_empty_outputs():
    """Test Answer node with empty outputs configuration"""
    graph_config = {
        "edges": [
            {
                "id": "start-source-answer-target",
                "source": "start",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "title": "No outputs",
                    "type": "answer",
                    "answer": "Simple answer",
                    "outputs": [],
                },
                "id": "answer",
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
    variable_pool = VariablePool(
        system_variables={SystemVariableKey.FILES: [], SystemVariableKey.USER_ID: "aaa"},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )

    node = AnswerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config={
            "id": "answer",
            "data": {
                "title": "No outputs",
                "type": "answer",
                "answer": "Simple answer",
                "outputs": [],
            },
        },
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["answer"] == "Simple answer"

    # Check that outputs field is empty when no outputs are configured
    assert "outputs" in result.outputs
    assert result.outputs["outputs"] == {}


def test_execute_answer_outputs_variable_not_found():
    """Test Answer node when output variable selector points to non-existent variable"""
    graph_config = {
        "edges": [
            {
                "id": "start-source-answer-target",
                "source": "start",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "title": "Missing variable",
                    "type": "answer",
                    "answer": "Test answer",
                    "outputs": [
                        {"variable": "missing_var", "type": "string", "value_selector": ["start", "non_existent"]}
                    ],
                },
                "id": "answer",
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

    # construct variable pool without the referenced variable
    variable_pool = VariablePool(
        system_variables={SystemVariableKey.FILES: [], SystemVariableKey.USER_ID: "aaa"},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )

    node = AnswerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config={
            "id": "answer",
            "data": {
                "title": "Missing variable",
                "type": "answer",
                "answer": "Test answer",
                "outputs": [{"variable": "missing_var", "type": "string", "value_selector": ["start", "non_existent"]}],
            },
        },
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs["answer"] == "Test answer"

    # Check that outputs field handles missing variables gracefully
    assert "outputs" in result.outputs
    outputs = result.outputs["outputs"]
    # Missing variables should result in None or empty value
    assert outputs.get("missing_var") is None or outputs.get("missing_var") == ""
