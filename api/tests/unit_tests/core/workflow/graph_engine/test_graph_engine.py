import time
from unittest.mock import patch

import pytest
from flask import Flask

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import NodeRunResult, WorkflowNodeExecutionMetadataKey
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
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
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState
from core.workflow.graph_engine.graph_engine import GraphEngine
from core.workflow.nodes.code.code_node import CodeNode
from core.workflow.nodes.event import RunCompletedEvent, RunStreamChunkEvent
from core.workflow.nodes.llm.node import LLMNode
from core.workflow.nodes.question_classifier.question_classifier_node import QuestionClassifierNode
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom
from models.workflow import WorkflowType


@pytest.fixture
def app():
    app = Flask(__name__)
    return app


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
        system_variables=SystemVariable(user_id="aaa", app_id="1", workflow_id="1", files=[]),
        user_inputs={"query": "hi"},
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
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
        graph_runtime_state=graph_runtime_state,
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
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 1,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 1,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: "USD",
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
        system_variables=SystemVariable(
            user_id="aaa",
            files=[],
            query="what's the weather in SF",
            conversation_id="abababa",
        ),
        user_inputs={},
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
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
        graph_runtime_state=graph_runtime_state,
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
        system_variables=SystemVariable(
            user_id="aaa",
            files=[],
            query="hi",
            conversation_id="abababa",
        ),
        user_inputs={"uid": "takato"},
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
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
        graph_runtime_state=graph_runtime_state,
        max_execution_steps=500,
        max_execution_time=1200,
    )

    # print("")

    items = []
    generator = graph_engine.run()
    for item in generator:
        items.append(item)

    assert len(items) == 10
    assert items[3].route_node_state.node_id == "if-else-1"
    assert items[4].route_node_state.node_id == "if-else-1"
    assert isinstance(items[5], NodeRunStreamChunkEvent)
    assert isinstance(items[6], NodeRunStreamChunkEvent)
    assert items[6].chunk_content == "takato"
    assert items[7].route_node_state.node_id == "answer-1"
    assert items[8].route_node_state.node_id == "answer-1"
    assert items[8].route_node_state.node_run_result.outputs["answer"] == "1 takato"
    assert isinstance(items[9], GraphRunSucceededEvent)

    # print(graph_engine.graph_runtime_state.model_dump_json(indent=2))


@patch("extensions.ext_database.db.session.remove")
@patch("extensions.ext_database.db.session.close")
def test_condition_parallel_correct_output(mock_close, mock_remove, app):
    """issue #16238, workflow got unexpected additional output"""

    graph_config = {
        "edges": [
            {
                "data": {
                    "isInIteration": False,
                    "isInLoop": False,
                    "sourceType": "question-classifier",
                    "targetType": "question-classifier",
                },
                "id": "1742382406742-1-1742382480077-target",
                "source": "1742382406742",
                "sourceHandle": "1",
                "target": "1742382480077",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 0,
            },
            {
                "data": {
                    "isInIteration": False,
                    "isInLoop": False,
                    "sourceType": "question-classifier",
                    "targetType": "answer",
                },
                "id": "1742382480077-1-1742382531085-target",
                "source": "1742382480077",
                "sourceHandle": "1",
                "target": "1742382531085",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 0,
            },
            {
                "data": {
                    "isInIteration": False,
                    "isInLoop": False,
                    "sourceType": "question-classifier",
                    "targetType": "answer",
                },
                "id": "1742382480077-2-1742382534798-target",
                "source": "1742382480077",
                "sourceHandle": "2",
                "target": "1742382534798",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 0,
            },
            {
                "data": {
                    "isInIteration": False,
                    "isInLoop": False,
                    "sourceType": "question-classifier",
                    "targetType": "answer",
                },
                "id": "1742382480077-1742382525856-1742382538517-target",
                "source": "1742382480077",
                "sourceHandle": "1742382525856",
                "target": "1742382538517",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 0,
            },
            {
                "data": {"isInLoop": False, "sourceType": "start", "targetType": "question-classifier"},
                "id": "1742382361944-source-1742382406742-target",
                "source": "1742382361944",
                "sourceHandle": "source",
                "target": "1742382406742",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 0,
            },
            {
                "data": {
                    "isInIteration": False,
                    "isInLoop": False,
                    "sourceType": "question-classifier",
                    "targetType": "code",
                },
                "id": "1742382406742-1-1742451801533-target",
                "source": "1742382406742",
                "sourceHandle": "1",
                "target": "1742451801533",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 0,
            },
            {
                "data": {"isInLoop": False, "sourceType": "code", "targetType": "answer"},
                "id": "1742451801533-source-1742434464898-target",
                "source": "1742451801533",
                "sourceHandle": "source",
                "target": "1742434464898",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 0,
            },
        ],
        "nodes": [
            {
                "data": {"desc": "", "selected": False, "title": "开始", "type": "start", "variables": []},
                "height": 54,
                "id": "1742382361944",
                "position": {"x": 30, "y": 286},
                "positionAbsolute": {"x": 30, "y": 286},
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
            },
            {
                "data": {
                    "classes": [{"id": "1", "name": "financial"}, {"id": "2", "name": "other"}],
                    "desc": "",
                    "instruction": "",
                    "instructions": "",
                    "model": {
                        "completion_params": {"temperature": 0.7},
                        "mode": "chat",
                        "name": "qwen-max-latest",
                        "provider": "langgenius/tongyi/tongyi",
                    },
                    "query_variable_selector": ["1742382361944", "sys.query"],
                    "selected": False,
                    "title": "qc",
                    "topics": [],
                    "type": "question-classifier",
                    "vision": {"enabled": False},
                },
                "height": 172,
                "id": "1742382406742",
                "position": {"x": 334, "y": 286},
                "positionAbsolute": {"x": 334, "y": 286},
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
            },
            {
                "data": {
                    "classes": [
                        {"id": "1", "name": "VAT"},
                        {"id": "2", "name": "Stamp Duty"},
                        {"id": "1742382525856", "name": "other"},
                    ],
                    "desc": "",
                    "instruction": "",
                    "instructions": "",
                    "model": {
                        "completion_params": {"temperature": 0.7},
                        "mode": "chat",
                        "name": "qwen-max-latest",
                        "provider": "langgenius/tongyi/tongyi",
                    },
                    "query_variable_selector": ["1742382361944", "sys.query"],
                    "selected": False,
                    "title": "qc 2",
                    "topics": [],
                    "type": "question-classifier",
                    "vision": {"enabled": False},
                },
                "height": 210,
                "id": "1742382480077",
                "position": {"x": 638, "y": 452},
                "positionAbsolute": {"x": 638, "y": 452},
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
            },
            {
                "data": {
                    "answer": "VAT:{{#sys.query#}}\n",
                    "desc": "",
                    "selected": False,
                    "title": "answer 2",
                    "type": "answer",
                    "variables": [],
                },
                "height": 105,
                "id": "1742382531085",
                "position": {"x": 942, "y": 486.5},
                "positionAbsolute": {"x": 942, "y": 486.5},
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
            },
            {
                "data": {
                    "answer": "Stamp Duty:{{#sys.query#}}\n",
                    "desc": "",
                    "selected": False,
                    "title": "answer 3",
                    "type": "answer",
                    "variables": [],
                },
                "height": 105,
                "id": "1742382534798",
                "position": {"x": 942, "y": 631.5},
                "positionAbsolute": {"x": 942, "y": 631.5},
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
            },
            {
                "data": {
                    "answer": "other:{{#sys.query#}}\n",
                    "desc": "",
                    "selected": False,
                    "title": "answer 4",
                    "type": "answer",
                    "variables": [],
                },
                "height": 105,
                "id": "1742382538517",
                "position": {"x": 942, "y": 776.5},
                "positionAbsolute": {"x": 942, "y": 776.5},
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
            },
            {
                "data": {
                    "answer": "{{#1742451801533.result#}}",
                    "desc": "",
                    "selected": False,
                    "title": "Answer 5",
                    "type": "answer",
                    "variables": [],
                },
                "height": 105,
                "id": "1742434464898",
                "position": {"x": 942, "y": 274.70425695336615},
                "positionAbsolute": {"x": 942, "y": 274.70425695336615},
                "selected": True,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
            },
            {
                "data": {
                    "code": '\ndef main(arg1: str, arg2: str) -> dict:\n    return {\n        "result": arg1 + arg2,\n    }\n',  # noqa: E501
                    "code_language": "python3",
                    "desc": "",
                    "outputs": {"result": {"children": None, "type": "string"}},
                    "selected": False,
                    "title": "Code",
                    "type": "code",
                    "variables": [
                        {"value_selector": ["sys", "query"], "variable": "arg1"},
                        {"value_selector": ["sys", "query"], "variable": "arg2"},
                    ],
                },
                "height": 54,
                "id": "1742451801533",
                "position": {"x": 627.8839285786928, "y": 286},
                "positionAbsolute": {"x": 627.8839285786928, "y": 286},
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
            },
        ],
    }
    graph = Graph.init(graph_config)

    # construct variable pool
    pool = VariablePool(
        system_variables=SystemVariable(
            user_id="1",
            files=[],
            query="dify",
            conversation_id="abababa",
        ),
        user_inputs={},
        environment_variables=[],
    )
    pool.add(["pe", "list_output"], ["dify-1", "dify-2"])
    variable_pool = VariablePool(
        system_variables=SystemVariable(
            user_id="aaa",
            files=[],
        ),
        user_inputs={"query": "hi"},
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
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
        graph_runtime_state=graph_runtime_state,
        max_execution_steps=500,
        max_execution_time=1200,
    )

    def qc_generator(self):
        yield RunCompletedEvent(
            run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={},
                process_data={},
                outputs={"class_name": "financial", "class_id": "1"},
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 1,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 1,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: "USD",
                },
                edge_source_handle="1",
            )
        )

    def code_generator(self):
        yield RunCompletedEvent(
            run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={},
                process_data={},
                outputs={"result": "dify 123"},
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 1,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 1,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: "USD",
                },
            )
        )

    with patch.object(QuestionClassifierNode, "_run", new=qc_generator):
        with app.app_context():
            with patch.object(CodeNode, "_run", new=code_generator):
                generator = graph_engine.run()
                stream_content = ""
                wrong_content = ["Stamp Duty", "other"]
                for item in generator:
                    if isinstance(item, NodeRunStreamChunkEvent):
                        stream_content += f"{item.chunk_content}\n"
                    if isinstance(item, GraphRunSucceededEvent):
                        assert item.outputs is not None
                        answer = item.outputs["answer"]
                        assert all(rc not in answer for rc in wrong_content)
