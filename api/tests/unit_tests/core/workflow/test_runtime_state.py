from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import sentinel

import pytest
from graphon.graph_engine.domain.graph_execution import GraphExecution
from graphon.graph_engine.ready_queue import InMemoryReadyQueue
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.runtime import GraphRuntimeState, VariablePool

from core.workflow.runtime_state import (
    bind_graph_runtime_state_to_graph,
    create_graph_runtime_state,
    ensure_graph_runtime_state_initialized,
    snapshot_graph_runtime_state,
)


class _FakeGraph:
    def __init__(self) -> None:
        self.nodes: dict[str, object] = {}
        self.edges: dict[str, object] = {}
        self.root_node = SimpleNamespace()

    def get_outgoing_edges(self, node_id: str) -> list[object]:
        _ = node_id
        return []


def _build_variable_pool() -> VariablePool:
    return VariablePool()


class TestCreateGraphRuntimeState:
    def test_initializes_explicit_collaborators_with_defaults(self) -> None:
        execution_context = sentinel.execution_context

        runtime_state = create_graph_runtime_state(
            variable_pool=_build_variable_pool(),
            start_at=12.5,
            workflow_id="workflow-id",
            execution_context=execution_context,
        )

        assert runtime_state.start_at == 12.5
        assert runtime_state.total_tokens == 0
        assert runtime_state.node_run_steps == 0
        assert runtime_state.llm_usage == LLMUsage.empty_usage()
        assert runtime_state.outputs == {}
        assert isinstance(runtime_state.ready_queue, InMemoryReadyQueue)
        assert runtime_state.graph_execution.workflow_id == "workflow-id"
        assert runtime_state.execution_context is execution_context

    def test_preserves_explicit_scalar_and_usage_values(self) -> None:
        llm_usage = LLMUsage.empty_usage()
        llm_usage.total_tokens = 9

        runtime_state = create_graph_runtime_state(
            variable_pool=_build_variable_pool(),
            start_at=3.0,
            workflow_id="workflow-id",
            total_tokens=7,
            llm_usage=llm_usage,
            outputs={"answer": "ok"},
            node_run_steps=4,
        )

        assert runtime_state.total_tokens == 7
        assert runtime_state.llm_usage == llm_usage
        assert runtime_state.outputs == {"answer": "ok"}
        assert runtime_state.node_run_steps == 4

    def test_rejects_blank_workflow_id(self) -> None:
        with pytest.raises(AssertionError, match="workflow_id must be a non-empty string"):
            create_graph_runtime_state(
                variable_pool=_build_variable_pool(),
                start_at=0.0,
                workflow_id="",
            )


class TestEnsureGraphRuntimeStateInitialized:
    def test_materializes_missing_ready_queue_and_graph_execution(self) -> None:
        runtime_state = GraphRuntimeState(
            variable_pool=_build_variable_pool(),
            start_at=0.0,
        )

        ensure_graph_runtime_state_initialized(
            runtime_state,
            workflow_id="workflow-id",
        )

        assert isinstance(runtime_state.ready_queue, InMemoryReadyQueue)
        assert runtime_state.graph_execution.workflow_id == "workflow-id"

    def test_backfills_empty_graph_execution_workflow_id(self) -> None:
        graph_execution = GraphExecution(workflow_id="")
        runtime_state = GraphRuntimeState(
            variable_pool=_build_variable_pool(),
            start_at=0.0,
            ready_queue=InMemoryReadyQueue(),
            graph_execution=graph_execution,
        )

        ensure_graph_runtime_state_initialized(
            runtime_state,
            workflow_id="workflow-id",
        )

        assert runtime_state.graph_execution is graph_execution
        assert graph_execution.workflow_id == "workflow-id"

    def test_preserves_existing_ready_queue_and_graph_execution(self) -> None:
        ready_queue = InMemoryReadyQueue()
        graph_execution = GraphExecution(workflow_id="workflow-id")
        runtime_state = GraphRuntimeState(
            variable_pool=_build_variable_pool(),
            start_at=0.0,
            ready_queue=ready_queue,
            graph_execution=graph_execution,
        )

        ensure_graph_runtime_state_initialized(
            runtime_state,
            workflow_id="workflow-id",
        )

        assert runtime_state.ready_queue is ready_queue
        assert runtime_state.graph_execution is graph_execution

    def test_rejects_mismatched_workflow_id(self) -> None:
        runtime_state = GraphRuntimeState(
            variable_pool=_build_variable_pool(),
            start_at=0.0,
            graph_execution=GraphExecution(workflow_id="other-workflow"),
        )

        with pytest.raises(AssertionError, match="workflow_id does not match graph execution workflow_id"):
            ensure_graph_runtime_state_initialized(
                runtime_state,
                workflow_id="workflow-id",
            )


class TestBindGraphRuntimeStateToGraph:
    def test_creates_response_coordinator_and_attaches_graph(self, monkeypatch: pytest.MonkeyPatch) -> None:
        runtime_state = GraphRuntimeState(
            variable_pool=_build_variable_pool(),
            start_at=0.0,
        )
        graph = _FakeGraph()
        coordinator = sentinel.response_coordinator

        monkeypatch.setattr(
            "core.workflow.runtime_state.ResponseStreamCoordinator",
            lambda *, variable_pool, graph: (
                coordinator if variable_pool is runtime_state.variable_pool and graph is graph else None
            ),
        )

        bind_graph_runtime_state_to_graph(
            runtime_state,
            graph,
            workflow_id="workflow-id",
        )

        assert runtime_state.response_coordinator is coordinator

    def test_preserves_existing_response_coordinator(self, monkeypatch: pytest.MonkeyPatch) -> None:
        existing_coordinator = sentinel.existing_coordinator
        runtime_state = GraphRuntimeState(
            variable_pool=_build_variable_pool(),
            start_at=0.0,
            response_coordinator=existing_coordinator,
        )

        monkeypatch.setattr(
            "core.workflow.runtime_state.ResponseStreamCoordinator",
            lambda **kwargs: pytest.fail(f"unexpected response coordinator construction: {kwargs}"),
        )

        bind_graph_runtime_state_to_graph(
            runtime_state,
            _FakeGraph(),
            workflow_id="workflow-id",
        )

        assert runtime_state.response_coordinator is existing_coordinator

    def test_rejects_attaching_a_different_graph_instance(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "core.workflow.runtime_state.ResponseStreamCoordinator",
            lambda **kwargs: sentinel.response_coordinator,
        )
        runtime_state = GraphRuntimeState(
            variable_pool=_build_variable_pool(),
            start_at=0.0,
        )
        first_graph = _FakeGraph()
        second_graph = _FakeGraph()

        bind_graph_runtime_state_to_graph(
            runtime_state,
            first_graph,
            workflow_id="workflow-id",
        )

        with pytest.raises(AssertionError, match="already attached to a different graph instance"):
            bind_graph_runtime_state_to_graph(
                runtime_state,
                second_graph,
                workflow_id="workflow-id",
            )


class TestSnapshotGraphRuntimeState:
    def test_serializes_sparse_state_after_explicit_initialization(self) -> None:
        runtime_state = GraphRuntimeState(
            variable_pool=_build_variable_pool(),
            start_at=0.0,
        )

        snapshot = snapshot_graph_runtime_state(
            runtime_state,
            workflow_id="workflow-id",
        )
        payload = json.loads(snapshot)

        assert payload["ready_queue"] is not None
        assert json.loads(payload["graph_execution"])["workflow_id"] == "workflow-id"
        assert payload["outputs"] == {}
