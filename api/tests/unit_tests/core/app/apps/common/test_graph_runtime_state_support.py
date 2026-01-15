from types import SimpleNamespace

import pytest

from core.app.apps.common.graph_runtime_state_support import GraphRuntimeStateSupport
from core.workflow.runtime import GraphRuntimeState
from core.workflow.runtime.variable_pool import VariablePool
from core.workflow.system_variable import SystemVariable


def _make_state(workflow_run_id: str | None) -> GraphRuntimeState:
    variable_pool = VariablePool(system_variables=SystemVariable(workflow_execution_id=workflow_run_id))
    return GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)


class _StubPipeline(GraphRuntimeStateSupport):
    def __init__(self, *, cached_state: GraphRuntimeState | None, queue_state: GraphRuntimeState | None):
        self._graph_runtime_state = cached_state
        self._base_task_pipeline = SimpleNamespace(queue_manager=SimpleNamespace(graph_runtime_state=queue_state))


def test_ensure_graph_runtime_initialized_caches_explicit_state():
    explicit_state = _make_state("run-explicit")
    pipeline = _StubPipeline(cached_state=None, queue_state=None)

    resolved = pipeline._ensure_graph_runtime_initialized(explicit_state)

    assert resolved is explicit_state
    assert pipeline._graph_runtime_state is explicit_state


def test_resolve_graph_runtime_state_reads_from_queue_when_cache_empty():
    queued_state = _make_state("run-queue")
    pipeline = _StubPipeline(cached_state=None, queue_state=queued_state)

    resolved = pipeline._resolve_graph_runtime_state()

    assert resolved is queued_state
    assert pipeline._graph_runtime_state is queued_state


def test_resolve_graph_runtime_state_raises_when_no_state_available():
    pipeline = _StubPipeline(cached_state=None, queue_state=None)

    with pytest.raises(ValueError):
        pipeline._resolve_graph_runtime_state()


def test_extract_workflow_run_id_returns_value():
    state = _make_state("run-identifier")
    pipeline = _StubPipeline(cached_state=state, queue_state=None)

    run_id = pipeline._extract_workflow_run_id(state)

    assert run_id == "run-identifier"


def test_extract_workflow_run_id_raises_when_missing():
    state = _make_state(None)
    pipeline = _StubPipeline(cached_state=state, queue_state=None)

    with pytest.raises(ValueError):
        pipeline._extract_workflow_run_id(state)
