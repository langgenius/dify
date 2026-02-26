from __future__ import annotations

from core.workflow.runtime.graph_runtime_state_protocol import ReadOnlyGraphRuntimeState, ReadOnlyVariablePool


def test_read_only_variable_pool_protocol_stubs_are_callable() -> None:
    dummy = object()

    assert ReadOnlyVariablePool.get(dummy, ["node", "key"]) is None
    assert ReadOnlyVariablePool.get_all_by_node(dummy, "node") is None
    assert ReadOnlyVariablePool.get_by_prefix(dummy, "node") is None


def test_read_only_graph_runtime_state_protocol_stubs_are_callable() -> None:
    dummy = object()

    assert ReadOnlyGraphRuntimeState.system_variable.fget(dummy) is None
    assert ReadOnlyGraphRuntimeState.variable_pool.fget(dummy) is None
    assert ReadOnlyGraphRuntimeState.start_at.fget(dummy) is None
    assert ReadOnlyGraphRuntimeState.total_tokens.fget(dummy) is None
    assert ReadOnlyGraphRuntimeState.llm_usage.fget(dummy) is None
    assert ReadOnlyGraphRuntimeState.outputs.fget(dummy) is None
    assert ReadOnlyGraphRuntimeState.node_run_steps.fget(dummy) is None
    assert ReadOnlyGraphRuntimeState.ready_queue_size.fget(dummy) is None
    assert ReadOnlyGraphRuntimeState.exceptions_count.fget(dummy) is None
    assert ReadOnlyGraphRuntimeState.get_output(dummy, "k", "default") is None
    assert ReadOnlyGraphRuntimeState.dumps(dummy) is None
