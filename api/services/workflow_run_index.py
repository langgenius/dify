"""Allocate each node execution's persisted and published index before it starts."""

from collections.abc import Mapping, Sequence
from threading import Lock
from types import MappingProxyType
from typing import override

from core.app.entities.queue_entities import NodeExecutionSnapshot
from core.workflow.node_runtime import resolve_dify_run_context
from graphon.engine.layer import Layer
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionMetadataKey
from graphon.nodes.base.node import Node


class WorkflowRunIndex(Layer):
    def __init__(self, root_executions: Sequence[WorkflowNodeExecution] = ()) -> None:
        super().__init__()
        self._lock = Lock()
        self._indices: dict[str, int] = {}
        self._next_indices: dict[tuple[str, str] | None, int] = {}
        self._seed(None, root_executions)
        self.root_snapshots = tuple(
            NodeExecutionSnapshot(
                execution_id=execution.node_execution_id or execution.id,
                title=execution.title,
                index=execution.index,
                start_at=execution.created_at,
                iteration_id=str((execution.metadata or {}).get(WorkflowNodeExecutionMetadataKey.ITERATION_ID) or ""),
                loop_id=str((execution.metadata or {}).get(WorkflowNodeExecutionMetadataKey.LOOP_ID) or ""),
            )
            for execution in root_executions
        )

    @property
    def indices(self) -> Mapping[str, int]:
        return MappingProxyType(self._indices)

    def index_for(self, execution_id: str) -> int:
        return self._indices[execution_id]

    def seed_source(self, app_id: str, workflow_id: str, executions: Sequence[WorkflowNodeExecution]) -> None:
        with self._lock:
            self._seed((app_id, workflow_id), executions)

    def _seed(self, scope: tuple[str, str] | None, executions: Sequence[WorkflowNodeExecution]) -> None:
        if scope in self._next_indices:
            return
        for execution in executions:
            self._indices[execution.id] = execution.index
            if execution.node_execution_id:
                self._indices[execution.node_execution_id] = execution.index
        self._next_indices[scope] = max((execution.index for execution in executions), default=0)

    @override
    def on_node_run_start(self, node: Node) -> None:
        context = resolve_dify_run_context(node.run_context)
        scope = (context.app_id, node.workflow_id) if context.workflow_tool_invocation_id else None
        with self._lock:
            if node.execution_id not in self._indices:
                self._next_indices[scope] = self._next_indices.get(scope, 0) + 1
                self._indices[node.execution_id] = self._next_indices[scope]
