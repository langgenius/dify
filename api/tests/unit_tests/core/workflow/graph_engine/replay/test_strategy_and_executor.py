from __future__ import annotations

import copy
import queue
from datetime import datetime
from types import SimpleNamespace

from dify_graph.enums import NodeExecutionType, NodeType, WorkflowNodeExecutionMetadataKey
from dify_graph.file.enums import FileTransferMethod, FileType
from dify_graph.file.models import File
from dify_graph.graph_engine.ready_queue import InMemoryReadyQueue
from dify_graph.graph_engine.replay import (
    BaselineNodeSnapshot,
    DefaultNodeExecutionStrategyResolver,
    DefaultReplayExecutionExecutor,
    ExecutionStrategyDecision,
    RerunOverrideContext,
)
from dify_graph.graph_engine.worker import Worker
from dify_graph.graph_events import NodeRunStartedEvent, NodeRunSucceededEvent
from dify_graph.node_events import NodeRunResult
from dify_graph.runtime import VariablePool
from dify_graph.system_variable import SystemVariable
from dify_graph.variables.segments import ArrayFileSegment, FileSegment


class _StubNode:
    def __init__(
        self,
        *,
        node_id: str,
        node_type: NodeType,
        execution_type: NodeExecutionType = NodeExecutionType.EXECUTABLE,
    ) -> None:
        self.id = node_id
        self.node_type = node_type
        self.execution_type = execution_type
        self.title = f"title-{node_id}"
        self._execution_id = f"execution-{node_id}"

    def ensure_execution_id(self) -> str:
        return self._execution_id

    @property
    def execution_id(self) -> str:
        return self._execution_id

    @staticmethod
    def version() -> str:
        return "1"


def _build_snapshot(
    *,
    node_id: str,
    outputs: dict[str, object] | None = None,
    edge_source_handle: str | None = None,
) -> BaselineNodeSnapshot:
    return BaselineNodeSnapshot(
        node_id=node_id,
        source_workflow_run_id="run-source",
        source_node_execution_id="exec-source",
        inputs={"in": "value"},
        process_data={"process": "value"},
        outputs=outputs if outputs is not None else {"out": "baseline"},
        edge_source_handle=edge_source_handle,
    )


def _build_variable_pool() -> VariablePool:
    system_variables = SystemVariable.default()
    system_variables.workflow_execution_id = "run-new"
    system_variables.timestamp = 1000
    return VariablePool(
        system_variables=system_variables,
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )


def _build_file_mapping(*, remote_url: str, filename: str) -> dict[str, object]:
    return {
        "dify_model_identity": "__dify__file__",
        "tenant_id": "tenant-1",
        "type": "image",
        "transfer_method": "remote_url",
        "remote_url": remote_url,
        "filename": filename,
        "extension": ".png",
        "mime_type": "image/png",
        "size": 1,
    }


def test_strategy_resolver_prefers_real_set() -> None:
    resolver = DefaultNodeExecutionStrategyResolver(
        real_node_ids={"node-a"},
        baseline_snapshots_by_node_id={"node-a": _build_snapshot(node_id="node-a")},
    )

    decision = resolver.resolve(node_id="node-a", is_branch_node=False)

    assert decision.mode == "real"
    assert decision.reason is None


def test_strategy_resolver_downgrades_branch_without_edge_source_handle() -> None:
    resolver = DefaultNodeExecutionStrategyResolver(
        real_node_ids=set(),
        baseline_snapshots_by_node_id={"branch": _build_snapshot(node_id="branch", edge_source_handle=None)},
    )

    decision = resolver.resolve(node_id="branch", is_branch_node=True)

    assert decision.mode == "real"
    assert decision.reason == "missing_edge_source_handle"


def test_strategy_resolver_tracks_override_selectors() -> None:
    resolver = DefaultNodeExecutionStrategyResolver(
        real_node_ids=set(),
        baseline_snapshots_by_node_id={},
        override_context=RerunOverrideContext(override_root_selectors_by_node_id={"node-a": ["out"]}),
    )

    assert resolver.has_override_selector(node_id="node-a", variable_name="out")
    assert not resolver.has_override_selector(node_id="node-a", variable_name="missing")


def test_replay_executor_uses_override_value_over_baseline() -> None:
    variable_pool = _build_variable_pool()
    variable_pool.add(["node-a", "out"], "override-value")
    override_context = RerunOverrideContext(override_root_selectors_by_node_id={"node-a": ["out"]})
    executor = DefaultReplayExecutionExecutor(variable_pool=variable_pool, override_context=override_context)
    node = _StubNode(node_id="node-a", node_type=NodeType.LLM)
    snapshot = _build_snapshot(node_id="node-a", outputs={"out": "baseline-value", "keep": "baseline-keep"})

    events = list(executor.execute(node=node, snapshot=snapshot))

    assert isinstance(events[0], NodeRunStartedEvent)
    assert isinstance(events[1], NodeRunSucceededEvent)
    outputs = events[1].node_run_result.outputs
    assert outputs["out"] == "override-value"
    assert outputs["keep"] == "baseline-keep"


def test_replay_executor_uses_file_value_from_variable_pool_for_override() -> None:
    variable_pool = _build_variable_pool()
    override_file = File(
        tenant_id="tenant-1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/new.png",
        filename="new.png",
        extension=".png",
        mime_type="image/png",
        size=1,
    )
    variable_pool.add(["start", "input_file"], override_file)

    override_context = RerunOverrideContext(override_root_selectors_by_node_id={"start": ["input_file"]})
    executor = DefaultReplayExecutionExecutor(variable_pool=variable_pool, override_context=override_context)
    node = _StubNode(node_id="start", node_type=NodeType.START, execution_type=NodeExecutionType.ROOT)
    snapshot = _build_snapshot(
        node_id="start",
        outputs={"input_file": {"dify_model_identity": "__dify__file__", "remote_url": "https://example.com/old.png"}},
    )

    events = list(executor.execute(node=node, snapshot=snapshot))
    result = events[1].node_run_result

    assert isinstance(result.outputs["input_file"], File)
    assert result.outputs["input_file"].remote_url == "https://example.com/new.png"


def test_replay_executor_rebuilds_file_value_from_baseline_snapshot() -> None:
    variable_pool = _build_variable_pool()
    executor = DefaultReplayExecutionExecutor(variable_pool=variable_pool, override_context=RerunOverrideContext())
    node = _StubNode(node_id="start", node_type=NodeType.START, execution_type=NodeExecutionType.ROOT)
    snapshot = _build_snapshot(
        node_id="start",
        outputs={"input_file": _build_file_mapping(remote_url="https://example.com/baseline.png", filename="a.png")},
    )

    events = list(executor.execute(node=node, snapshot=snapshot))
    result = events[1].node_run_result

    assert isinstance(result.outputs["input_file"], File)
    assert result.outputs["input_file"].remote_url == "https://example.com/baseline.png"

    variable_pool.add(["start", "input_file"], result.outputs["input_file"])
    segment = variable_pool.get(["start", "input_file"])
    assert isinstance(segment, FileSegment)


def test_replay_executor_rebuilds_file_list_from_baseline_snapshot() -> None:
    variable_pool = _build_variable_pool()
    executor = DefaultReplayExecutionExecutor(variable_pool=variable_pool, override_context=RerunOverrideContext())
    node = _StubNode(node_id="start", node_type=NodeType.START, execution_type=NodeExecutionType.ROOT)
    snapshot = _build_snapshot(
        node_id="start",
        outputs={
            "input_files": [
                _build_file_mapping(remote_url="https://example.com/1.png", filename="1.png"),
                _build_file_mapping(remote_url="https://example.com/2.png", filename="2.png"),
            ]
        },
    )

    events = list(executor.execute(node=node, snapshot=snapshot))
    result = events[1].node_run_result

    files = result.outputs["input_files"]
    assert isinstance(files, list)
    assert all(isinstance(item, File) for item in files)
    assert [item.remote_url for item in files] == ["https://example.com/1.png", "https://example.com/2.png"]

    variable_pool.add(["start", "input_files"], files)
    segment = variable_pool.get(["start", "input_files"])
    assert isinstance(segment, ArrayFileSegment)


def test_override_context_accepts_legacy_values_by_node_id_payload() -> None:
    context = RerunOverrideContext.model_validate(
        {
            "values_by_node_id": {
                "node-a": {"out": "override-value", "keep": "legacy"},
                "node-b": {"score": 1},
            }
        }
    )

    assert context.has_selector(node_id="node-a", variable_name="out")
    assert context.has_selector(node_id="node-a", variable_name="keep")
    assert context.has_selector(node_id="node-b", variable_name="score")
    assert not context.has_selector(node_id="node-b", variable_name="missing")

    dumped = context.model_dump()
    assert "values_by_node_id" not in dumped
    assert dumped["override_root_selectors_by_node_id"] == {
        "node-a": ["keep", "out"],
        "node-b": ["score"],
    }

    restored = RerunOverrideContext.model_validate(copy.deepcopy(dumped))
    assert restored.get_variable_names(node_id="node-a") == {"keep", "out"}


def test_replay_executor_rewrites_start_sys_outputs_with_current_runtime_values() -> None:
    variable_pool = _build_variable_pool()
    override_context = RerunOverrideContext()
    executor = DefaultReplayExecutionExecutor(variable_pool=variable_pool, override_context=override_context)
    node = _StubNode(node_id="start", node_type=NodeType.START, execution_type=NodeExecutionType.ROOT)
    snapshot = _build_snapshot(
        node_id="start",
        outputs={"sys.workflow_run_id": "run-old", "sys.timestamp": 1, "query": "hello"},
    )

    events = list(executor.execute(node=node, snapshot=snapshot))
    result = events[1].node_run_result

    assert result.outputs["sys.workflow_run_id"] == "run-new"
    assert result.outputs["sys.timestamp"] == 1000
    assert result.outputs["query"] == "hello"


def test_replay_executor_emits_replay_metadata() -> None:
    variable_pool = _build_variable_pool()
    override_context = RerunOverrideContext()
    executor = DefaultReplayExecutionExecutor(variable_pool=variable_pool, override_context=override_context)
    node = _StubNode(node_id="branch", node_type=NodeType.IF_ELSE, execution_type=NodeExecutionType.BRANCH)
    snapshot = _build_snapshot(node_id="branch", edge_source_handle="true")

    events = list(executor.execute(node=node, snapshot=snapshot))
    result = events[1].node_run_result

    assert result.metadata[WorkflowNodeExecutionMetadataKey.EXECUTION_MODE] == "replay"
    assert result.metadata[WorkflowNodeExecutionMetadataKey.SOURCE_WORKFLOW_RUN_ID] == "run-source"
    assert result.metadata[WorkflowNodeExecutionMetadataKey.SOURCE_NODE_EXECUTION_ID] == "exec-source"
    assert result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 0
    assert result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] == 0
    assert result.metadata[WorkflowNodeExecutionMetadataKey.EDGE_SOURCE_HANDLE] == "true"
    assert result.edge_source_handle == "true"


def test_worker_applies_override_value_for_real_node_outputs() -> None:
    variable_pool = _build_variable_pool()
    variable_pool.add(["node-a", "out"], "override-value")
    resolver = DefaultNodeExecutionStrategyResolver(
        real_node_ids={"node-a"},
        baseline_snapshots_by_node_id={},
        override_context=RerunOverrideContext(override_root_selectors_by_node_id={"node-a": ["out"]}),
    )
    graph = SimpleNamespace(
        nodes={
            "node-a": SimpleNamespace(graph_runtime_state=SimpleNamespace(variable_pool=variable_pool)),
        }
    )
    worker = Worker(
        ready_queue=InMemoryReadyQueue(),
        event_queue=queue.Queue(),
        graph=graph,
        layers=[],
        node_execution_strategy_resolver=resolver,
    )
    event = NodeRunSucceededEvent(
        id="node-a-exec",
        node_id="node-a",
        node_type=NodeType.LLM,
        start_at=datetime.now(),
        node_run_result=NodeRunResult(
            outputs={"out": "real-value", "keep": "keep-value"},
        ),
    )

    worker._inject_execution_metadata(event=event, decision=ExecutionStrategyDecision.real())

    assert event.node_run_result.outputs["out"] == "override-value"
    assert event.node_run_result.outputs["keep"] == "keep-value"
    assert event.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.EXECUTION_MODE] == "real"


def test_worker_resets_usage_metadata_for_replay_node() -> None:
    variable_pool = _build_variable_pool()
    resolver = DefaultNodeExecutionStrategyResolver(
        real_node_ids=set(),
        baseline_snapshots_by_node_id={},
        override_context=RerunOverrideContext(),
    )
    graph = SimpleNamespace(
        nodes={
            "node-a": SimpleNamespace(graph_runtime_state=SimpleNamespace(variable_pool=variable_pool)),
        }
    )
    worker = Worker(
        ready_queue=InMemoryReadyQueue(),
        event_queue=queue.Queue(),
        graph=graph,
        layers=[],
        node_execution_strategy_resolver=resolver,
    )
    replay_snapshot = _build_snapshot(node_id="node-a")
    event = NodeRunSucceededEvent(
        id="node-a-exec",
        node_id="node-a",
        node_type=NodeType.LLM,
        start_at=datetime.now(),
        node_run_result=NodeRunResult(
            metadata={
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 123,
                WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 4.5,
            }
        ),
    )

    worker._inject_execution_metadata(event=event, decision=ExecutionStrategyDecision.replay(snapshot=replay_snapshot))

    assert event.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.EXECUTION_MODE] == "replay"
    assert event.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 0
    assert event.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] == 0
