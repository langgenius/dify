import time
from contextlib import nullcontext
from datetime import UTC, datetime

import pytest

from dify_graph.enums import BuiltinNodeTypes
from dify_graph.graph_events import NodeRunSucceededEvent
from dify_graph.model_runtime.entities.llm_entities import LLMUsage
from dify_graph.nodes.iteration.entities import ErrorHandleMode, IterationNodeData
from dify_graph.nodes.iteration.iteration_node import IterationNode


def test_parallel_iteration_duration_map_uses_worker_measured_time() -> None:
    node = IterationNode.__new__(IterationNode)
    node._node_data = IterationNodeData(
        title="Parallel Iteration",
        iterator_selector=["start", "items"],
        output_selector=["iteration", "output"],
        is_parallel=True,
        parallel_nums=2,
        error_handle_mode=ErrorHandleMode.TERMINATED,
    )
    node._capture_execution_context = lambda: nullcontext()
    node._sync_conversation_variables_from_snapshot = lambda snapshot: None
    node._merge_usage = lambda current, new: new if current.total_tokens == 0 else current.plus(new)

    def fake_execute_single_iteration_parallel(*, index: int, item: object, execution_context: object):
        return (
            0.1 + (index * 0.1),
            [
                NodeRunSucceededEvent(
                    id=f"exec-{index}",
                    node_id=f"llm-{index}",
                    node_type=BuiltinNodeTypes.LLM,
                    start_at=datetime.now(UTC).replace(tzinfo=None),
                ),
            ],
            f"output-{item}",
            {},
            LLMUsage.empty_usage(),
        )

    node._execute_single_iteration_parallel = fake_execute_single_iteration_parallel

    outputs: list[object] = []
    iter_run_map: dict[str, float] = {}
    usage_accumulator = [LLMUsage.empty_usage()]

    generator = node._execute_parallel_iterations(
        iterator_list_value=["a", "b"],
        outputs=outputs,
        iter_run_map=iter_run_map,
        usage_accumulator=usage_accumulator,
    )

    for _ in generator:
        # Simulate a slow consumer replaying buffered events.
        time.sleep(0.02)

    assert outputs == ["output-a", "output-b"]
    assert iter_run_map["0"] == pytest.approx(0.1)
    assert iter_run_map["1"] == pytest.approx(0.2)
