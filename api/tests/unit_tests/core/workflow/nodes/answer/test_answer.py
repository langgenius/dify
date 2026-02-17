from __future__ import annotations

import time
import uuid
from unittest.mock import MagicMock, Mock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.node_factory import DifyNodeFactory
from core.file.enums import FileTransferMethod, FileType
from core.file.models import File
from core.variables import ArrayFileSegment, FileSegment
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.base.template import Template
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from extensions.ext_database import db
from models.enums import UserFrom


def test_execute_answer():
    graph_config = {
        "edges": [
            {
                "id": "start-source-answer-target",
                "source": "start",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start", "title": "Start"}, "id": "start"},
            {
                "data": {
                    "title": "123",
                    "type": "answer",
                    "answer": "Today's weather is {{#start.weather#}}\n{{#llm.text#}}\n{{img}}\nFin.",
                },
                "id": "answer",
            },
        ],
    }

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["start", "weather"], "sunny")
    variable_pool.add(["llm", "text"], "You are a helpful AI.")

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    # create node factory
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node_config = {
        "id": "answer",
        "data": {
            "title": "123",
            "type": "answer",
            "answer": "Today's weather is {{#start.weather#}}\n{{#llm.text#}}\n{{img}}\nFin.",
        },
    }

    node = AnswerNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        config=node_config,
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # execute node
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["answer"] == "Today's weather is sunny\nYou are a helpful AI.\n{{img}}\nFin."


def _make_file(*, file_id: str) -> File:
    return File(
        id=file_id,
        tenant_id="tenant",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url=f"https://example.com/{file_id}.png",
        storage_key="key",
    )


def test_extract_files_from_segments() -> None:
    file_a = _make_file(file_id="a")
    file_b = _make_file(file_id="b")
    file_c = _make_file(file_id="c")

    segments = [
        FileSegment(value=file_a),
        ArrayFileSegment(value=[file_b, file_c]),
    ]

    node = AnswerNode.__new__(AnswerNode)
    files = node._extract_files_from_segments(segments)

    assert files == [file_a, file_b, file_c]


def test_answer_node_variable_mapping() -> None:
    mapping = AnswerNode._extract_variable_selector_to_variable_mapping(
        graph_config={},
        node_id="answer",
        node_data={
            "title": "Answer",
            "answer": "Hello {{#start.name#}} and {{#llm.text#}}",
        },
    )

    assert mapping == {
        "answer.#start.name#": ["start", "name"],
        "answer.#llm.text#": ["llm", "text"],
    }


def test_answer_node_streaming_template() -> None:
    graph_init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config={},
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    node_config = {
        "id": "answer",
        "data": {"title": "Answer", "answer": "Hello {{#start.name#}}"},
    }

    node = AnswerNode(
        id="answer",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=Mock(),
    )

    template = node.get_streaming_template()

    assert isinstance(template, Template)
    assert str(template) == "Hello {{#start.name#}}"
