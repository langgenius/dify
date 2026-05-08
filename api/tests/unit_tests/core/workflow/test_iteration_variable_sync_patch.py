from __future__ import annotations

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.graph_events.node import NodeRunVariableUpdatedEvent
from graphon.node_events.base import NodeRunResult
from graphon.runtime import VariablePool
from graphon.variables.types import SegmentType
from graphon.variables.variables import ArrayStringVariable

from core.app.workflow.layers.iteration_variable_sync import IterationVariableSyncLayer


def _make_array_variable(name: str, values: list[str]) -> ArrayStringVariable:
    return ArrayStringVariable(
        id="conv-var-1",
        name=name,
        value=values,
        value_type=SegmentType.ARRAY_STRING,
        selector=["conversation", name],
    )


def _make_var_update_event(variable: ArrayStringVariable) -> NodeRunVariableUpdatedEvent:
    return NodeRunVariableUpdatedEvent(
        id="exec-1",
        node_id="var-assigner",
        node_type=BuiltinNodeTypes.VARIABLE_ASSIGNER,
        node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED),
        variable=variable,
    )


class TestIterationVariableSyncLayer:
    def test_variable_update_applied_to_parent_pool(self):
        parent_pool = VariablePool()
        parent_pool.add(["conversation", "list"], _make_array_variable("list", []))

        layer = IterationVariableSyncLayer(parent_pool)
        updated_var = _make_array_variable("list", ["file1.txt"])
        layer.on_event(_make_var_update_event(updated_var))

        result = parent_pool.get(["conversation", "list"])
        assert result is not None
        assert result.value == ["file1.txt"]

    def test_sequential_appends_all_visible(self):
        """Simulate 4 sequential iterations each appending one filename."""
        parent_pool = VariablePool()
        parent_pool.add(["conversation", "list"], _make_array_variable("list", []))

        layer = IterationVariableSyncLayer(parent_pool)
        filenames = ["a.txt", "b.txt", "c.txt", "d.txt"]

        for name in filenames:
            current = parent_pool.get(["conversation", "list"])
            assert current is not None
            new_values = list(current.value) + [name]

            layer.on_event(_make_var_update_event(_make_array_variable("list", new_values)))

            snapshot = parent_pool.model_copy(deep=True)
            snapshot_var = snapshot.get(["conversation", "list"])
            assert snapshot_var is not None
            assert snapshot_var.value == new_values

        final = parent_pool.get(["conversation", "list"])
        assert final is not None
        assert final.value == ["a.txt", "b.txt", "c.txt", "d.txt"]

    def test_non_variable_events_are_ignored(self):
        """Events that are not variable-updates must be silently ignored."""
        from graphon.graph_events.graph import GraphRunStartedEvent

        parent_pool = VariablePool()
        parent_pool.add(["conversation", "list"], _make_array_variable("list", ["x"]))

        layer = IterationVariableSyncLayer(parent_pool)
        layer.on_event(GraphRunStartedEvent())

        result = parent_pool.get(["conversation", "list"])
        assert result is not None
        assert result.value == ["x"]
