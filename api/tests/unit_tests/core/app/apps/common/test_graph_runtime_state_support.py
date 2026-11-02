import pytest

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.common.graph_runtime_state_support import GraphRuntimeStateSupport
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity
from core.app.entities.queue_entities import AppQueueEvent
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.workflow.system_variables import build_system_variables
from core.workflow.variable_pool_initializer import add_variables_to_pool
from graphon.runtime import RuntimeState, VariablePool


def _make_state(workflow_run_id: str | None) -> RuntimeState:
    variable_pool = VariablePool()
    add_variables_to_pool(variable_pool, build_system_variables(workflow_execution_id=workflow_run_id))
    return RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0.0)


class _QueueManager(AppQueueManager):
    """Expose a fixed runtime state without Redis or a live task queue."""

    def __init__(self, graph_runtime_state: RuntimeState | None) -> None:
        self.graph_runtime_state = graph_runtime_state

    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        raise NotImplementedError("The runtime state stub never publishes queue events")


class _Pipeline(BasedGenerateTaskPipeline[ChatAppGenerateEntity]):
    """Pipeline stand-in carrying the queue manager the mixin reads from."""

    def __init__(self, *, queue_state: RuntimeState | None) -> None:
        self.queue_manager = _QueueManager(queue_state)


class _StubPipeline(GraphRuntimeStateSupport):
    def __init__(self, *, cached_state: RuntimeState | None, queue_state: RuntimeState | None) -> None:
        self._graph_runtime_state = cached_state
        self._base_task_pipeline = _Pipeline(queue_state=queue_state)


def test_ensure_graph_runtime_initialized_caches_explicit_state() -> None:
    explicit_state = _make_state("run-explicit")
    pipeline = _StubPipeline(cached_state=None, queue_state=None)

    resolved = pipeline._ensure_graph_runtime_initialized(explicit_state)

    assert resolved is explicit_state
    assert pipeline._graph_runtime_state is explicit_state


def test_resolve_graph_runtime_state_reads_from_queue_when_cache_empty() -> None:
    queued_state = _make_state("run-queue")
    pipeline = _StubPipeline(cached_state=None, queue_state=queued_state)

    resolved = pipeline._resolve_graph_runtime_state()

    assert resolved is queued_state
    assert pipeline._graph_runtime_state is queued_state


def test_resolve_graph_runtime_state_raises_when_no_state_available() -> None:
    pipeline = _StubPipeline(cached_state=None, queue_state=None)

    with pytest.raises(ValueError, match="graph runtime state not initialized\\."):
        pipeline._resolve_graph_runtime_state()


def test_extract_workflow_run_id_returns_value() -> None:
    state = _make_state("run-identifier")
    pipeline = _StubPipeline(cached_state=state, queue_state=None)

    run_id = pipeline._extract_workflow_run_id(state)

    assert run_id == "run-identifier"


def test_extract_workflow_run_id_raises_when_missing() -> None:
    state = _make_state(None)
    pipeline = _StubPipeline(cached_state=state, queue_state=None)

    with pytest.raises(ValueError, match="workflow_execution_id missing from runtime state"):
        pipeline._extract_workflow_run_id(state)
