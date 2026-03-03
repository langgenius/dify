from __future__ import annotations

import copy
from collections.abc import Generator, Mapping
from typing import Any

from dify_graph.enums import NodeType, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from dify_graph.graph_events import GraphNodeEventBase, NodeRunStartedEvent, NodeRunSucceededEvent
from dify_graph.node_events import NodeRunResult
from dify_graph.nodes.base.node import Node
from dify_graph.runtime import VariablePool
from libs.datetime_utils import naive_utc_now

from .types import BaselineNodeSnapshot, ReplayExecutionExecutor, RerunOverrideContext, normalize_execution_metadata


class DefaultReplayExecutionExecutor(ReplayExecutionExecutor):
    """Replay executor that reconstructs standard node events from baseline snapshots."""

    def __init__(
        self,
        *,
        variable_pool: VariablePool,
        override_context: RerunOverrideContext,
    ) -> None:
        self._variable_pool = variable_pool
        self._override_context = override_context

    def execute(self, *, node: Node, snapshot: BaselineNodeSnapshot) -> Generator[GraphNodeEventBase, None, None]:
        execution_id = node.ensure_execution_id()
        start_at = naive_utc_now()
        node_run_result = self._build_node_run_result(node=node, snapshot=snapshot)

        yield NodeRunStartedEvent(
            id=execution_id,
            node_id=node.id,
            node_type=node.node_type,
            node_title=node.title,
            start_at=start_at,
            node_version=node.version(),
        )
        yield NodeRunSucceededEvent(
            id=execution_id,
            node_id=node.id,
            node_type=node.node_type,
            start_at=start_at,
            node_run_result=node_run_result,
            node_version=node.version(),
        )

    def _build_node_run_result(self, *, node: Node, snapshot: BaselineNodeSnapshot) -> NodeRunResult:
        inputs = self._mapping_to_dict(snapshot.inputs)
        process_data = self._mapping_to_dict(snapshot.process_data)
        outputs = self._build_outputs(node=node, snapshot=snapshot)
        edge_source_handle = snapshot.resolved_edge_source_handle()

        metadata = normalize_execution_metadata(snapshot.execution_metadata)
        metadata[WorkflowNodeExecutionMetadataKey.EXECUTION_MODE] = "replay"
        metadata[WorkflowNodeExecutionMetadataKey.SOURCE_WORKFLOW_RUN_ID] = snapshot.source_workflow_run_id
        metadata[WorkflowNodeExecutionMetadataKey.SOURCE_NODE_EXECUTION_ID] = snapshot.source_node_execution_id
        self._reset_replay_usage_metadata(metadata)
        if edge_source_handle:
            metadata[WorkflowNodeExecutionMetadataKey.EDGE_SOURCE_HANDLE] = edge_source_handle

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
            outputs=outputs,
            metadata=metadata,
            edge_source_handle=edge_source_handle or "source",
        )

    def _build_outputs(self, *, node: Node, snapshot: BaselineNodeSnapshot) -> dict[str, Any]:
        baseline_outputs = self._mapping_to_dict(snapshot.outputs)
        output_keys = set(baseline_outputs.keys()) | self._override_context.get_variable_names(node_id=node.id)

        merged_outputs: dict[str, Any] = {}
        for variable_name in output_keys:
            if self._override_context.has_selector(node_id=node.id, variable_name=variable_name):
                override_segment = self._variable_pool.get([node.id, variable_name])
                if override_segment is not None:
                    merged_outputs[variable_name] = copy.deepcopy(override_segment.value)
                    continue
            if variable_name in baseline_outputs:
                merged_outputs[variable_name] = copy.deepcopy(baseline_outputs[variable_name])

        if node.node_type == NodeType.START:
            self._rewrite_start_sys_outputs(outputs=merged_outputs)

        return merged_outputs

    def _rewrite_start_sys_outputs(self, *, outputs: dict[str, Any]) -> None:
        system_values = self._variable_pool.system_variables.to_dict()
        for key in list(outputs.keys()):
            if not key.startswith("sys."):
                continue
            system_key = key[4:]
            if system_key in system_values:
                outputs[key] = copy.deepcopy(system_values[system_key])

    @staticmethod
    def _mapping_to_dict(mapping: Mapping[str, Any] | None) -> dict[str, Any]:
        if not isinstance(mapping, Mapping):
            return {}
        return {str(key): copy.deepcopy(value) for key, value in mapping.items()}

    @staticmethod
    def _reset_replay_usage_metadata(metadata: dict[WorkflowNodeExecutionMetadataKey, Any]) -> None:
        # Replay nodes are treated as skipped executions in tracing, so usage metrics must be zeroed.
        metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] = 0
        metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] = 0
