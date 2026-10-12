from copy import deepcopy
from threading import Event, Thread
from types import MethodType

from core.workflow.workflow_entry import iter_dify_graph_engine_events
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import NodeRunExceptionEvent, NodeRunStreamChunkEvent
from graphon.node_events import NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from services.dify_response_stream_filter import DifyResponseStreamFilter
from tests.unit_tests.core.workflow.graph_engine.test_mock_config import MockConfigBuilder
from tests.unit_tests.core.workflow.graph_engine.test_table_runner import WorkflowRunner


def _build_fail_branch_graph(
    *, node_error: str | None = None, answer: str = "{{#llm.text#}}", extra_success_answer: bool = False
):
    runner = WorkflowRunner()
    fixture_data = deepcopy(runner.load_fixture("response_stream_filter_issue_170_workflow"))
    graph_config = fixture_data["workflow"]["graph"]
    graph_config["edges"] = [
        {
            "id": "start-llm",
            "source": "start",
            "sourceHandle": "source",
            "target": "llm",
            "targetHandle": "target",
        },
        {
            "id": "llm-answer",
            "source": "llm",
            "sourceHandle": "source",
            "target": "answer",
            "targetHandle": "target",
        },
        {
            "id": "llm-failure-answer",
            "source": "llm",
            "sourceHandle": "fail-branch",
            "target": "failure_answer",
            "targetHandle": "target",
        },
    ]
    if extra_success_answer:
        graph_config["edges"].append(
            {
                "id": "llm-static-answer",
                "source": "llm",
                "sourceHandle": "source",
                "target": "static_answer",
                "targetHandle": "target",
            }
        )
    graph_config["nodes"] = [node for node in graph_config["nodes"] if node["id"] != "dufu"]
    llm_node = next(node for node in graph_config["nodes"] if node["id"] == "llm")
    llm_node["data"]["error_strategy"] = "fail-branch"
    answer_node = next(node for node in graph_config["nodes"] if node["id"] == "answer")
    answer_node["data"]["answer"] = answer
    graph_config["nodes"].append(
        {
            "id": "failure_answer",
            "type": "custom",
            "data": {
                "answer": "Agent failed",
                "desc": "",
                "title": "Failure Answer",
                "type": "answer",
                "variables": [],
            },
            "position": {"x": 680, "y": 482},
            "sourcePosition": "right",
            "targetPosition": "left",
        }
    )
    if extra_success_answer:
        graph_config["nodes"].append(
            {
                "id": "static_answer",
                "type": "custom",
                "data": {
                    "answer": "Success path",
                    "desc": "",
                    "title": "Static Answer",
                    "type": "answer",
                    "variables": [],
                },
                "position": {"x": 680, "y": 382},
                "sourcePosition": "right",
                "targetPosition": "left",
            }
        )
    mock_config = (
        MockConfigBuilder()
        .with_node_output(
            "llm",
            {
                "text": "Quiet Night Thought",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
                "finish_reason": "stop",
            },
        )
        .build()
    )
    if node_error is not None:
        mock_config.set_node_error("llm", node_error)
    graph, graph_runtime_state = runner.create_graph_from_fixture(
        fixture_data=fixture_data,
        query="1",
        use_mock_factory=True,
        mock_config=mock_config,
    )
    return graph, graph_runtime_state


def test_fail_branch_node_streams_referenced_answer_before_node_completion() -> None:
    graph, graph_runtime_state = _build_fail_branch_graph()
    node = graph.nodes["llm"]
    release = Event()
    started = Event()
    completed = Event()

    def _controlled_run(_self):
        started.set()
        yield StreamChunkEvent(selector=["llm", "text"], chunk="first", is_final=False)
        release.wait(timeout=10)
        completed.set()
        yield StreamChunkEvent(selector=["llm", "text"], chunk=" second", is_final=False)
        yield StreamChunkEvent(selector=["llm", "text"], chunk="", is_final=True)
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"text": "first second"},
            )
        )

    node._run = MethodType(_controlled_run, node)
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )

    class TimingFilter(DifyResponseStreamFilter):
        observed_chunk_before_completion = False

        def on_event(self, event):
            if isinstance(event, NodeRunStreamChunkEvent) and event.selector[:2] == ["llm", "text"]:
                self.observed_chunk_before_completion |= not completed.is_set()
            return super().on_event(event)

    response_filter = TimingFilter()

    def _release_after_start() -> None:
        started.wait(timeout=5)
        release.wait(timeout=2)
        release.set()

    Thread(target=_release_after_start, daemon=True).start()
    observed_before_completion = False
    failure_answer_emitted = False
    for event in iter_dify_graph_engine_events(engine, response_filter):
        if isinstance(event, NodeRunStreamChunkEvent) and event.node_id == "failure_answer":
            failure_answer_emitted = True
        if isinstance(event, NodeRunStreamChunkEvent) and event.selector[:2] == ["llm", "text"] and not event.is_final:
            observed_before_completion |= not completed.is_set()

    assert started.is_set()
    assert response_filter.observed_chunk_before_completion
    assert observed_before_completion
    assert not failure_answer_emitted


def test_fail_branch_error_still_reaches_failure_answer() -> None:
    graph, graph_runtime_state = _build_fail_branch_graph(node_error="node failed")
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )
    events = list(iter_dify_graph_engine_events(engine))

    assert any(isinstance(event, NodeRunExceptionEvent) and event.node_id == "llm" for event in events)
    failure_chunks = [
        event.chunk
        for event in events
        if isinstance(event, NodeRunStreamChunkEvent) and event.node_id == "failure_answer"
    ]
    assert "Agent failed".join(failure_chunks) == "Agent failed"


def test_late_fail_branch_error_releases_stream_session_for_failure_answer() -> None:
    graph, graph_runtime_state = _build_fail_branch_graph()
    node = graph.nodes["llm"]
    release = Event()
    started = Event()

    def _controlled_failure(_self):
        started.set()
        yield StreamChunkEvent(selector=["llm", "text"], chunk="partial", is_final=False)
        release.wait(timeout=10)
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="late failure",
                error_type="MockError",
            )
        )

    node._run = MethodType(_controlled_failure, node)
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )

    def _release_after_start() -> None:
        started.wait(timeout=5)
        release.wait(timeout=2)
        release.set()

    Thread(target=_release_after_start, daemon=True).start()
    events = list(iter_dify_graph_engine_events(engine, DifyResponseStreamFilter()))

    failure_chunks = [
        event.chunk
        for event in events
        if isinstance(event, NodeRunStreamChunkEvent) and event.node_id == "failure_answer"
    ]
    assert started.is_set()
    assert "Agent failed".join(failure_chunks) == "Agent failed"


def test_failed_node_does_not_emit_static_success_answer() -> None:
    graph, graph_runtime_state = _build_fail_branch_graph(extra_success_answer=True)
    node = graph.nodes["llm"]

    def _controlled_failure(_self):
        yield StreamChunkEvent(selector=["llm", "text"], chunk="partial", is_final=False)
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="late failure",
                error_type="MockError",
            )
        )

    node._run = MethodType(_controlled_failure, node)
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )
    events = list(iter_dify_graph_engine_events(engine, DifyResponseStreamFilter()))

    static_success_chunks = [
        event.chunk
        for event in events
        if isinstance(event, NodeRunStreamChunkEvent) and event.node_id == "static_answer"
    ]
    failure_chunks = [
        event.chunk
        for event in events
        if isinstance(event, NodeRunStreamChunkEvent) and event.node_id == "failure_answer"
    ]
    assert "Success path".join(static_success_chunks) != "Success path"
    assert "Agent failed".join(failure_chunks) == "Agent failed"
