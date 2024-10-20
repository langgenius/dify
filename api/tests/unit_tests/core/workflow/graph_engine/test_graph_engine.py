from unittest.mock import patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.event import (
    BaseNodeEvent,
    GraphRunFailedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState
from core.workflow.graph_engine.graph_engine import GraphEngine
from core.workflow.nodes.event import RunCompletedEvent, RunStreamChunkEvent
from core.workflow.nodes.llm.node import LLMNode
from models.enums import UserFrom
from models.workflow import WorkflowNodeExecutionStatus, WorkflowType


@patch("extensions.ext_database.db.session.remove")
@patch("extensions.ext_database.db.session.close")
def test_run_parallel_in_workflow(mock_close, mock_remove):
    graph_config = {
        "edges": [
            {
                "id": "1",
                "source": "start",
                "target": "llm1",
            },
            {
                "id": "2",
                "source": "llm1",
                "target": "llm2",
            },
            {
                "id": "3",
                "source": "llm1",
                "target": "llm3",
            },
            {
                "id": "4",
                "source": "llm2",
                "target": "end1",
            },
            {
                "id": "5",
                "source": "llm3",
                "target": "end2",
            },
        ],
        "nodes": [
            {
                "data": {
                    "type": "start",
                    "title": "start",
                    "variables": [
                        {
                            "label": "query",
                            "max_length": 48,
                            "options": [],
                            "required": True,
                            "type": "text-input",
                            "variable": "query",
                        }
                    ],
                },
                "id": "start",
            },
            {
                "data": {
                    "type": "llm",
                    "title": "llm1",
                    "context": {"enabled": False, "variable_selector": []},
                    "model": {
                        "completion_params": {"temperature": 0.7},
                        "mode": "chat",
                        "name": "gpt-4o",
                        "provider": "openai",
                    },
                    "prompt_template": [
                        {"role": "system", "text": "say hi"},
                        {"role": "user", "text": "{{#start.query#}}"},
                    ],
                    "vision": {"configs": {"detail": "high", "variable_selector": []}, "enabled": False},
                },
                "id": "llm1",
            },
            {
                "data": {
                    "type": "llm",
                    "title": "llm2",
                    "context": {"enabled": False, "variable_selector": []},
                    "model": {
                        "completion_params": {"temperature": 0.7},
                        "mode": "chat",
                        "name": "gpt-4o",
                        "provider": "openai",
                    },
                    "prompt_template": [
                        {"role": "system", "text": "say bye"},
                        {"role": "user", "text": "{{#start.query#}}"},
                    ],
                    "vision": {"configs": {"detail": "high", "variable_selector": []}, "enabled": False},
                },
                "id": "llm2",
            },
            {
                "data": {
                    "type": "llm",
                    "title": "llm3",
                    "context": {"enabled": False, "variable_selector": []},
                    "model": {
                        "completion_params": {"temperature": 0.7},
                        "mode": "chat",
                        "name": "gpt-4o",
                        "provider": "openai",
                    },
                    "prompt_template": [
                        {"role": "system", "text": "say good morning"},
                        {"role": "user", "text": "{{#start.query#}}"},
                    ],
                    "vision": {"configs": {"detail": "high", "variable_selector": []}, "enabled": False},
                },
                "id": "llm3",
            },
            {
                "data": {
                    "type": "end",
                    "title": "end1",
                    "outputs": [
                        {"value_selector": ["llm2", "text"], "variable": "result2"},
                        {"value_selector": ["start", "query"], "variable": "query"},
                    ],
                },
                "id": "end1",
            },
            {
                "data": {
                    "type": "end",
                    "title": "end2",
                    "outputs": [
                        {"value_selector": ["llm1", "text"], "variable": "result1"},
                        {"value_selector": ["llm3", "text"], "variable": "result3"},
                    ],
                },
                "id": "end2",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    variable_pool = VariablePool(
        system_variables={SystemVariableKey.FILES: [], SystemVariableKey.USER_ID: "aaa"}, user_inputs={"query": "hi"}
    )

    graph_engine = GraphEngine(
        tenant_id="111",
        app_id="222",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_id="333",
        graph_config=graph_config,
        user_id="444",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        graph=graph,
        variable_pool=variable_pool,
        max_execution_steps=500,
        max_execution_time=1200,
    )

    def llm_generator(self):
        contents = ["hi", "bye", "good morning"]

        yield RunStreamChunkEvent(
            chunk_content=contents[int(self.node_id[-1]) - 1], from_variable_selector=[self.node_id, "text"]
        )

        yield RunCompletedEvent(
            run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={},
                process_data={},
                outputs={},
                metadata={
                    NodeRunMetadataKey.TOTAL_TOKENS: 1,
                    NodeRunMetadataKey.TOTAL_PRICE: 1,
                    NodeRunMetadataKey.CURRENCY: "USD",
                },
            )
        )

    # print("")

    with patch.object(LLMNode, "_run", new=llm_generator):
        items = []
        generator = graph_engine.run()
        for item in generator:
            # print(type(item), item)
            items.append(item)
            if isinstance(item, NodeRunSucceededEvent):
                assert item.route_node_state.status == RouteNodeState.Status.SUCCESS

            assert not isinstance(item, NodeRunFailedEvent)
            assert not isinstance(item, GraphRunFailedEvent)

            if isinstance(item, BaseNodeEvent) and item.route_node_state.node_id in {"llm2", "llm3", "end1", "end2"}:
                assert item.parallel_id is not None

        assert len(items) == 18
        assert isinstance(items[0], GraphRunStartedEvent)
        assert isinstance(items[1], NodeRunStartedEvent)
        assert items[1].route_node_state.node_id == "start"
        assert isinstance(items[2], NodeRunSucceededEvent)
        assert items[2].route_node_state.node_id == "start"


@patch("extensions.ext_database.db.session.remove")
@patch("extensions.ext_database.db.session.close")
def test_run_parallel_in_chatflow(mock_close, mock_remove):
    graph_config = {
        "edges": [
            {
                "id": "1",
                "source": "start",
                "target": "answer1",
            },
            {
                "id": "2",
                "source": "answer1",
                "target": "answer2",
            },
            {
                "id": "3",
                "source": "answer1",
                "target": "answer3",
            },
            {
                "id": "4",
                "source": "answer2",
                "target": "answer4",
            },
            {
                "id": "5",
                "source": "answer3",
                "target": "answer5",
            },
        ],
        "nodes": [
            {"data": {"type": "start", "title": "start"}, "id": "start"},
            {"data": {"type": "answer", "title": "answer1", "answer": "1"}, "id": "answer1"},
            {
                "data": {"type": "answer", "title": "answer2", "answer": "2"},
                "id": "answer2",
            },
            {
                "data": {"type": "answer", "title": "answer3", "answer": "3"},
                "id": "answer3",
            },
            {
                "data": {"type": "answer", "title": "answer4", "answer": "4"},
                "id": "answer4",
            },
            {
                "data": {"type": "answer", "title": "answer5", "answer": "5"},
                "id": "answer5",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    variable_pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "what's the weather in SF",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "aaa",
        },
        user_inputs={},
    )

    graph_engine = GraphEngine(
        tenant_id="111",
        app_id="222",
        workflow_type=WorkflowType.CHAT,
        workflow_id="333",
        graph_config=graph_config,
        user_id="444",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        graph=graph,
        variable_pool=variable_pool,
        max_execution_steps=500,
        max_execution_time=1200,
    )

    # print("")

    items = []
    generator = graph_engine.run()
    for item in generator:
        # print(type(item), item)
        items.append(item)
        if isinstance(item, NodeRunSucceededEvent):
            assert item.route_node_state.status == RouteNodeState.Status.SUCCESS

        assert not isinstance(item, NodeRunFailedEvent)
        assert not isinstance(item, GraphRunFailedEvent)

        if isinstance(item, BaseNodeEvent) and item.route_node_state.node_id in {
            "answer2",
            "answer3",
            "answer4",
            "answer5",
        }:
            assert item.parallel_id is not None

    assert len(items) == 23
    assert isinstance(items[0], GraphRunStartedEvent)
    assert isinstance(items[1], NodeRunStartedEvent)
    assert items[1].route_node_state.node_id == "start"
    assert isinstance(items[2], NodeRunSucceededEvent)
    assert items[2].route_node_state.node_id == "start"


@patch("extensions.ext_database.db.session.remove")
@patch("extensions.ext_database.db.session.close")
def test_run_branch(mock_close, mock_remove):
    graph_config = {
        "edges": [
            {
                "id": "1",
                "source": "start",
                "target": "if-else-1",
            },
            {
                "id": "2",
                "source": "if-else-1",
                "sourceHandle": "true",
                "target": "answer-1",
            },
            {
                "id": "3",
                "source": "if-else-1",
                "sourceHandle": "false",
                "target": "if-else-2",
            },
            {
                "id": "4",
                "source": "if-else-2",
                "sourceHandle": "true",
                "target": "answer-2",
            },
            {
                "id": "5",
                "source": "if-else-2",
                "sourceHandle": "false",
                "target": "answer-3",
            },
        ],
        "nodes": [
            {
                "data": {
                    "title": "Start",
                    "type": "start",
                    "variables": [
                        {
                            "label": "uid",
                            "max_length": 48,
                            "options": [],
                            "required": True,
                            "type": "text-input",
                            "variable": "uid",
                        }
                    ],
                },
                "id": "start",
            },
            {
                "data": {"answer": "1 {{#start.uid#}}", "title": "Answer", "type": "answer", "variables": []},
                "id": "answer-1",
            },
            {
                "data": {
                    "cases": [
                        {
                            "case_id": "true",
                            "conditions": [
                                {
                                    "comparison_operator": "contains",
                                    "id": "b0f02473-08b6-4a81-af91-15345dcb2ec8",
                                    "value": "hi",
                                    "varType": "string",
                                    "variable_selector": ["sys", "query"],
                                }
                            ],
                            "id": "true",
                            "logical_operator": "and",
                        }
                    ],
                    "desc": "",
                    "title": "IF/ELSE",
                    "type": "if-else",
                },
                "id": "if-else-1",
            },
            {
                "data": {
                    "cases": [
                        {
                            "case_id": "true",
                            "conditions": [
                                {
                                    "comparison_operator": "contains",
                                    "id": "ae895199-5608-433b-b5f0-0997ae1431e4",
                                    "value": "takatost",
                                    "varType": "string",
                                    "variable_selector": ["sys", "query"],
                                }
                            ],
                            "id": "true",
                            "logical_operator": "and",
                        }
                    ],
                    "title": "IF/ELSE 2",
                    "type": "if-else",
                },
                "id": "if-else-2",
            },
            {
                "data": {
                    "answer": "2",
                    "title": "Answer 2",
                    "type": "answer",
                },
                "id": "answer-2",
            },
            {
                "data": {
                    "answer": "3",
                    "title": "Answer 3",
                    "type": "answer",
                },
                "id": "answer-3",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    variable_pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "hi",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "aaa",
        },
        user_inputs={"uid": "takato"},
    )

    graph_engine = GraphEngine(
        tenant_id="111",
        app_id="222",
        workflow_type=WorkflowType.CHAT,
        workflow_id="333",
        graph_config=graph_config,
        user_id="444",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        graph=graph,
        variable_pool=variable_pool,
        max_execution_steps=500,
        max_execution_time=1200,
    )

    # print("")

    items = []
    generator = graph_engine.run()
    for item in generator:
        # print(type(item), item)
        items.append(item)

    assert len(items) == 10
    assert items[3].route_node_state.node_id == "if-else-1"
    assert items[4].route_node_state.node_id == "if-else-1"
    assert isinstance(items[5], NodeRunStreamChunkEvent)
    assert items[5].chunk_content == "1 "
    assert isinstance(items[6], NodeRunStreamChunkEvent)
    assert items[6].chunk_content == "takato"
    assert items[7].route_node_state.node_id == "answer-1"
    assert items[8].route_node_state.node_id == "answer-1"
    assert items[8].route_node_state.node_run_result.outputs["answer"] == "1 takato"
    assert isinstance(items[9], GraphRunSucceededEvent)

    # print(graph_engine.graph_runtime_state.model_dump_json(indent=2))
