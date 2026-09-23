"""Allocate each node execution's persisted and published index before it starts."""

from collections.abc import Mapping, Sequence
from threading import Lock
from types import MappingProxyType
from typing import override

from core.app.entities.queue_entities import NodeExecutionSnapshot
from graphon.engine.layer import Layer
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionMetadataKey
from graphon.nodes.base.node import Node


class WorkflowRunIndex(Layer):
    def __init__(self, root_executions: Sequence[WorkflowNodeExecution] = ()) -> None:
        super().__init__()
        self._lock = Lock()
        self._indices: dict[str, int] = {}
        for execution in root_executions:
            self._indices[execution.id] = execution.index
            if execution.node_execution_id:
                self._indices[execution.node_execution_id] = execution.index
        self._next_index = max((execution.index for execution in root_executions), default=0)
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

    @override
    def on_node_run_start(self, node: Node) -> None:
        with self._lock:
            if node.execution_id not in self._indices:
                self._next_index += 1
                self._indices[node.execution_id] = self._next_index
