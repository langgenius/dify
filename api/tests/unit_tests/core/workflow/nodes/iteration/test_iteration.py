import time
import uuid
from unittest.mock import patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.event import RunCompletedEvent
from core.workflow.nodes.iteration.entities import ErrorHandleMode
from core.workflow.nodes.iteration.iteration_node import IterationNode
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode
from models.enums import UserFrom
from models.workflow import WorkflowNodeExecutionStatus, WorkflowType


def test_run():
    graph_config = {
        "edges": [
            {
                "id": "start-source-pe-target",
                "source": "start",
                "target": "pe",
            },
            {
                "id": "iteration-1-source-answer-3-target",
                "source": "iteration-1",
                "target": "answer-3",
            },
            {
                "id": "tt-source-if-else-target",
                "source": "tt",
                "target": "if-else",
            },
            {
                "id": "if-else-true-answer-2-target",
                "source": "if-else",
                "sourceHandle": "true",
                "target": "answer-2",
            },
            {
                "id": "if-else-false-answer-4-target",
                "source": "if-else",
                "sourceHandle": "false",
                "target": "answer-4",
            },
            {
                "id": "pe-source-iteration-1-target",
                "source": "pe",
                "target": "iteration-1",
            },
        ],
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "data": {
                    "iterator_selector": ["pe", "list_output"],
                    "output_selector": ["tt", "output"],
                    "output_type": "array[string]",
                    "startNodeType": "template-transform",
                    "start_node_id": "tt",
                    "title": "iteration",
                    "type": "iteration",
                },
                "id": "iteration-1",
            },
            {
                "data": {
                    "answer": "{{#tt.output#}}",
                    "iteration_id": "iteration-1",
                    "title": "answer 2",
                    "type": "answer",
                },
                "id": "answer-2",
            },
            {
                "data": {
                    "iteration_id": "iteration-1",
                    "template": "{{ arg1 }} 123",
                    "title": "template transform",
                    "type": "template-transform",
                    "variables": [{"value_selector": ["sys", "query"], "variable": "arg1"}],
                },
                "id": "tt",
            },
            {
                "data": {"answer": "{{#iteration-1.output#}}88888", "title": "answer 3", "type": "answer"},
                "id": "answer-3",
            },
            {
                "data": {
                    "conditions": [
                        {
                            "comparison_operator": "is",
                            "id": "1721916275284",
                            "value": "hi",
                            "variable_selector": ["sys", "query"],
                        }
                    ],
                    "iteration_id": "iteration-1",
                    "logical_operator": "and",
                    "title": "if",
                    "type": "if-else",
                },
                "id": "if-else",
            },
            {
                "data": {"answer": "no hi", "iteration_id": "iteration-1", "title": "answer 4", "type": "answer"},
                "id": "answer-4",
            },
            {
                "data": {
                    "instruction": "test1",
                    "model": {
                        "completion_params": {"temperature": 0.7},
                        "mode": "chat",
                        "name": "gpt-4o",
                        "provider": "openai",
                    },
                    "parameters": [
                        {"description": "test", "name": "list_output", "required": False, "type": "array[string]"}
                    ],
                    "query": ["sys", "query"],
                    "reasoning_mode": "prompt",
                    "title": "pe",
                    "type": "parameter-extractor",
                },
                "id": "pe",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_type=WorkflowType.CHAT,
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "dify",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "1",
        },
        user_inputs={},
        environment_variables=[],
    )
    pool.add(["pe", "list_output"], ["dify-1", "dify-2"])

    iteration_node = IterationNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter()),
        config={
            "data": {
                "iterator_selector": ["pe", "list_output"],
                "output_selector": ["tt", "output"],
                "output_type": "array[string]",
                "startNodeType": "template-transform",
                "start_node_id": "tt",
                "title": "迭代",
                "type": "iteration",
            },
            "id": "iteration-1",
        },
    )

    def tt_generator(self):
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"iterator_selector": "dify"},
            outputs={"output": "dify 123"},
        )

    with patch.object(TemplateTransformNode, "_run", new=tt_generator):
        # execute node
        result = iteration_node._run()

        count = 0
        for item in result:
            # print(type(item), item)
            count += 1
            if isinstance(item, RunCompletedEvent):
                assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                assert item.run_result.outputs == {"output": ["dify 123", "dify 123"]}

        assert count == 20


def test_run_parallel():
    graph_config = {
        "edges": [
            {
                "id": "start-source-pe-target",
                "source": "start",
                "target": "pe",
            },
            {
                "id": "iteration-1-source-answer-3-target",
                "source": "iteration-1",
                "target": "answer-3",
            },
            {
                "id": "iteration-start-source-tt-target",
                "source": "iteration-start",
                "target": "tt",
            },
            {
                "id": "iteration-start-source-tt-2-target",
                "source": "iteration-start",
                "target": "tt-2",
            },
            {
                "id": "tt-source-if-else-target",
                "source": "tt",
                "target": "if-else",
            },
            {
                "id": "tt-2-source-if-else-target",
                "source": "tt-2",
                "target": "if-else",
            },
            {
                "id": "if-else-true-answer-2-target",
                "source": "if-else",
                "sourceHandle": "true",
                "target": "answer-2",
            },
            {
                "id": "if-else-false-answer-4-target",
                "source": "if-else",
                "sourceHandle": "false",
                "target": "answer-4",
            },
            {
                "id": "pe-source-iteration-1-target",
                "source": "pe",
                "target": "iteration-1",
            },
        ],
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "data": {
                    "iterator_selector": ["pe", "list_output"],
                    "output_selector": ["tt", "output"],
                    "output_type": "array[string]",
                    "startNodeType": "template-transform",
                    "start_node_id": "iteration-start",
                    "title": "iteration",
                    "type": "iteration",
                },
                "id": "iteration-1",
            },
            {
                "data": {
                    "answer": "{{#tt.output#}}",
                    "iteration_id": "iteration-1",
                    "title": "answer 2",
                    "type": "answer",
                },
                "id": "answer-2",
            },
            {
                "data": {
                    "iteration_id": "iteration-1",
                    "title": "iteration-start",
                    "type": "iteration-start",
                },
                "id": "iteration-start",
            },
            {
                "data": {
                    "iteration_id": "iteration-1",
                    "template": "{{ arg1 }} 123",
                    "title": "template transform",
                    "type": "template-transform",
                    "variables": [{"value_selector": ["sys", "query"], "variable": "arg1"}],
                },
                "id": "tt",
            },
            {
                "data": {
                    "iteration_id": "iteration-1",
                    "template": "{{ arg1 }} 321",
                    "title": "template transform",
                    "type": "template-transform",
                    "variables": [{"value_selector": ["sys", "query"], "variable": "arg1"}],
                },
                "id": "tt-2",
            },
            {
                "data": {"answer": "{{#iteration-1.output#}}88888", "title": "answer 3", "type": "answer"},
                "id": "answer-3",
            },
            {
                "data": {
                    "conditions": [
                        {
                            "comparison_operator": "is",
                            "id": "1721916275284",
                            "value": "hi",
                            "variable_selector": ["sys", "query"],
                        }
                    ],
                    "iteration_id": "iteration-1",
                    "logical_operator": "and",
                    "title": "if",
                    "type": "if-else",
                },
                "id": "if-else",
            },
            {
                "data": {"answer": "no hi", "iteration_id": "iteration-1", "title": "answer 4", "type": "answer"},
                "id": "answer-4",
            },
            {
                "data": {
                    "instruction": "test1",
                    "model": {
                        "completion_params": {"temperature": 0.7},
                        "mode": "chat",
                        "name": "gpt-4o",
                        "provider": "openai",
                    },
                    "parameters": [
                        {"description": "test", "name": "list_output", "required": False, "type": "array[string]"}
                    ],
                    "query": ["sys", "query"],
                    "reasoning_mode": "prompt",
                    "title": "pe",
                    "type": "parameter-extractor",
                },
                "id": "pe",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_type=WorkflowType.CHAT,
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "dify",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "1",
        },
        user_inputs={},
        environment_variables=[],
    )
    pool.add(["pe", "list_output"], ["dify-1", "dify-2"])

    iteration_node = IterationNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter()),
        config={
            "data": {
                "iterator_selector": ["pe", "list_output"],
                "output_selector": ["tt", "output"],
                "output_type": "array[string]",
                "startNodeType": "template-transform",
                "start_node_id": "iteration-start",
                "title": "迭代",
                "type": "iteration",
            },
            "id": "iteration-1",
        },
    )

    def tt_generator(self):
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"iterator_selector": "dify"},
            outputs={"output": "dify 123"},
        )

    with patch.object(TemplateTransformNode, "_run", new=tt_generator):
        # execute node
        result = iteration_node._run()

        count = 0
        for item in result:
            count += 1
            if isinstance(item, RunCompletedEvent):
                assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                assert item.run_result.outputs == {"output": ["dify 123", "dify 123"]}

        assert count == 32


def test_iteration_run_in_parallel_mode():
    graph_config = {
        "edges": [
            {
                "id": "start-source-pe-target",
                "source": "start",
                "target": "pe",
            },
            {
                "id": "iteration-1-source-answer-3-target",
                "source": "iteration-1",
                "target": "answer-3",
            },
            {
                "id": "iteration-start-source-tt-target",
                "source": "iteration-start",
                "target": "tt",
            },
            {
                "id": "iteration-start-source-tt-2-target",
                "source": "iteration-start",
                "target": "tt-2",
            },
            {
                "id": "tt-source-if-else-target",
                "source": "tt",
                "target": "if-else",
            },
            {
                "id": "tt-2-source-if-else-target",
                "source": "tt-2",
                "target": "if-else",
            },
            {
                "id": "if-else-true-answer-2-target",
                "source": "if-else",
                "sourceHandle": "true",
                "target": "answer-2",
            },
            {
                "id": "if-else-false-answer-4-target",
                "source": "if-else",
                "sourceHandle": "false",
                "target": "answer-4",
            },
            {
                "id": "pe-source-iteration-1-target",
                "source": "pe",
                "target": "iteration-1",
            },
        ],
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "data": {
                    "iterator_selector": ["pe", "list_output"],
                    "output_selector": ["tt", "output"],
                    "output_type": "array[string]",
                    "startNodeType": "template-transform",
                    "start_node_id": "iteration-start",
                    "title": "iteration",
                    "type": "iteration",
                },
                "id": "iteration-1",
            },
            {
                "data": {
                    "answer": "{{#tt.output#}}",
                    "iteration_id": "iteration-1",
                    "title": "answer 2",
                    "type": "answer",
                },
                "id": "answer-2",
            },
            {
                "data": {
                    "iteration_id": "iteration-1",
                    "title": "iteration-start",
                    "type": "iteration-start",
                },
                "id": "iteration-start",
            },
            {
                "data": {
                    "iteration_id": "iteration-1",
                    "template": "{{ arg1 }} 123",
                    "title": "template transform",
                    "type": "template-transform",
                    "variables": [{"value_selector": ["sys", "query"], "variable": "arg1"}],
                },
                "id": "tt",
            },
            {
                "data": {
                    "iteration_id": "iteration-1",
                    "template": "{{ arg1 }} 321",
                    "title": "template transform",
                    "type": "template-transform",
                    "variables": [{"value_selector": ["sys", "query"], "variable": "arg1"}],
                },
                "id": "tt-2",
            },
            {
                "data": {"answer": "{{#iteration-1.output#}}88888", "title": "answer 3", "type": "answer"},
                "id": "answer-3",
            },
            {
                "data": {
                    "conditions": [
                        {
                            "comparison_operator": "is",
                            "id": "1721916275284",
                            "value": "hi",
                            "variable_selector": ["sys", "query"],
                        }
                    ],
                    "iteration_id": "iteration-1",
                    "logical_operator": "and",
                    "title": "if",
                    "type": "if-else",
                },
                "id": "if-else",
            },
            {
                "data": {"answer": "no hi", "iteration_id": "iteration-1", "title": "answer 4", "type": "answer"},
                "id": "answer-4",
            },
            {
                "data": {
                    "instruction": "test1",
                    "model": {
                        "completion_params": {"temperature": 0.7},
                        "mode": "chat",
                        "name": "gpt-4o",
                        "provider": "openai",
                    },
                    "parameters": [
                        {"description": "test", "name": "list_output", "required": False, "type": "array[string]"}
                    ],
                    "query": ["sys", "query"],
                    "reasoning_mode": "prompt",
                    "title": "pe",
                    "type": "parameter-extractor",
                },
                "id": "pe",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_type=WorkflowType.CHAT,
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "dify",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "1",
        },
        user_inputs={},
        environment_variables=[],
    )
    pool.add(["pe", "list_output"], ["dify-1", "dify-2"])

    parallel_iteration_node = IterationNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter()),
        config={
            "data": {
                "iterator_selector": ["pe", "list_output"],
                "output_selector": ["tt", "output"],
                "output_type": "array[string]",
                "startNodeType": "template-transform",
                "start_node_id": "iteration-start",
                "title": "迭代",
                "type": "iteration",
                "is_parallel": True,
            },
            "id": "iteration-1",
        },
    )
    sequential_iteration_node = IterationNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter()),
        config={
            "data": {
                "iterator_selector": ["pe", "list_output"],
                "output_selector": ["tt", "output"],
                "output_type": "array[string]",
                "startNodeType": "template-transform",
                "start_node_id": "iteration-start",
                "title": "迭代",
                "type": "iteration",
                "is_parallel": True,
            },
            "id": "iteration-1",
        },
    )

    def tt_generator(self):
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"iterator_selector": "dify"},
            outputs={"output": "dify 123"},
        )

    with patch.object(TemplateTransformNode, "_run", new=tt_generator):
        # execute node
        parallel_result = parallel_iteration_node._run()
        sequential_result = sequential_iteration_node._run()
        assert parallel_iteration_node.node_data.parallel_nums == 10
        assert parallel_iteration_node.node_data.error_handle_mode == ErrorHandleMode.TERMINATED
        count = 0
        parallel_arr = []
        sequential_arr = []
        for item in parallel_result:
            count += 1
            parallel_arr.append(item)
            if isinstance(item, RunCompletedEvent):
                assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                assert item.run_result.outputs == {"output": ["dify 123", "dify 123"]}
        assert count == 32

        for item in sequential_result:
            sequential_arr.append(item)
            count += 1
            if isinstance(item, RunCompletedEvent):
                assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                assert item.run_result.outputs == {"output": ["dify 123", "dify 123"]}
        assert count == 64


def test_iteration_run_error_handle():
    graph_config = {
        "edges": [
            {
                "id": "start-source-pe-target",
                "source": "start",
                "target": "pe",
            },
            {
                "id": "iteration-1-source-answer-3-target",
                "source": "iteration-1",
                "target": "answer-3",
            },
            {
                "id": "tt-source-if-else-target",
                "source": "iteration-start",
                "target": "if-else",
            },
            {
                "id": "if-else-true-answer-2-target",
                "source": "if-else",
                "sourceHandle": "true",
                "target": "tt",
            },
            {
                "id": "if-else-false-answer-4-target",
                "source": "if-else",
                "sourceHandle": "false",
                "target": "tt2",
            },
            {
                "id": "pe-source-iteration-1-target",
                "source": "pe",
                "target": "iteration-1",
            },
        ],
        "nodes": [
            {"data": {"title": "Start", "type": "start", "variables": []}, "id": "start"},
            {
                "data": {
                    "iterator_selector": ["pe", "list_output"],
                    "output_selector": ["tt2", "output"],
                    "output_type": "array[string]",
                    "start_node_id": "if-else",
                    "title": "iteration",
                    "type": "iteration",
                },
                "id": "iteration-1",
            },
            {
                "data": {
                    "iteration_id": "iteration-1",
                    "template": "{{ arg1.split(arg2) }}",
                    "title": "template transform",
                    "type": "template-transform",
                    "variables": [
                        {"value_selector": ["iteration-1", "item"], "variable": "arg1"},
                        {"value_selector": ["iteration-1", "index"], "variable": "arg2"},
                    ],
                },
                "id": "tt",
            },
            {
                "data": {
                    "iteration_id": "iteration-1",
                    "template": "{{ arg1 }}",
                    "title": "template transform",
                    "type": "template-transform",
                    "variables": [
                        {"value_selector": ["iteration-1", "item"], "variable": "arg1"},
                    ],
                },
                "id": "tt2",
            },
            {
                "data": {"answer": "{{#iteration-1.output#}}88888", "title": "answer 3", "type": "answer"},
                "id": "answer-3",
            },
            {
                "data": {
                    "iteration_id": "iteration-1",
                    "title": "iteration-start",
                    "type": "iteration-start",
                },
                "id": "iteration-start",
            },
            {
                "data": {
                    "conditions": [
                        {
                            "comparison_operator": "is",
                            "id": "1721916275284",
                            "value": "1",
                            "variable_selector": ["iteration-1", "item"],
                        }
                    ],
                    "iteration_id": "iteration-1",
                    "logical_operator": "and",
                    "title": "if",
                    "type": "if-else",
                },
                "id": "if-else",
            },
            {
                "data": {
                    "instruction": "test1",
                    "model": {
                        "completion_params": {"temperature": 0.7},
                        "mode": "chat",
                        "name": "gpt-4o",
                        "provider": "openai",
                    },
                    "parameters": [
                        {"description": "test", "name": "list_output", "required": False, "type": "array[string]"}
                    ],
                    "query": ["sys", "query"],
                    "reasoning_mode": "prompt",
                    "title": "pe",
                    "type": "parameter-extractor",
                },
                "id": "pe",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_type=WorkflowType.CHAT,
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "dify",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "1",
        },
        user_inputs={},
        environment_variables=[],
    )
    pool.add(["pe", "list_output"], ["1", "1"])
    iteration_node = IterationNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter()),
        config={
            "data": {
                "iterator_selector": ["pe", "list_output"],
                "output_selector": ["tt", "output"],
                "output_type": "array[string]",
                "startNodeType": "template-transform",
                "start_node_id": "iteration-start",
                "title": "iteration",
                "type": "iteration",
                "is_parallel": True,
                "error_handle_mode": ErrorHandleMode.CONTINUE_ON_ERROR,
            },
            "id": "iteration-1",
        },
    )
    # execute continue on error node
    result = iteration_node._run()
    result_arr = []
    count = 0
    for item in result:
        result_arr.append(item)
        count += 1
        if isinstance(item, RunCompletedEvent):
            assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
            assert item.run_result.outputs == {"output": [None, None]}

    assert count == 14
    # execute remove abnormal output
    iteration_node.node_data.error_handle_mode = ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT
    result = iteration_node._run()
    count = 0
    for item in result:
        count += 1
        if isinstance(item, RunCompletedEvent):
            assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
            assert item.run_result.outputs == {"output": []}
    assert count == 14
