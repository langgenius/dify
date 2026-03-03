from __future__ import annotations

from collections.abc import Mapping

from .types import BaselineNodeSnapshot, ExecutionStrategyDecision, NodeExecutionStrategyResolver


class DefaultNodeExecutionStrategyResolver(NodeExecutionStrategyResolver):
    """Resolve rerun execution mode for each node."""

    def __init__(
        self,
        *,
        real_node_ids: set[str],
        baseline_snapshots_by_node_id: Mapping[str, BaselineNodeSnapshot],
    ) -> None:
        self._real_node_ids = real_node_ids
        self._baseline_snapshots_by_node_id = baseline_snapshots_by_node_id

    def resolve(self, *, node_id: str, is_branch_node: bool) -> ExecutionStrategyDecision:
        if node_id in self._real_node_ids:
            return ExecutionStrategyDecision.real()

        snapshot = self._baseline_snapshots_by_node_id.get(node_id)
        if snapshot is None:
            return ExecutionStrategyDecision.real(reason="missing_baseline_snapshot")

        if not self._has_required_snapshot_fields(snapshot):
            return ExecutionStrategyDecision.real(reason="missing_required_node_run_result_fields")

        if is_branch_node and not snapshot.resolved_edge_source_handle():
            return ExecutionStrategyDecision.real(reason="missing_edge_source_handle")

        return ExecutionStrategyDecision.replay(snapshot=snapshot)

    @staticmethod
    def _has_required_snapshot_fields(snapshot: BaselineNodeSnapshot) -> bool:
        return (
            isinstance(snapshot.inputs, Mapping)
            and isinstance(snapshot.process_data, Mapping)
            and isinstance(snapshot.outputs, Mapping)
        )
