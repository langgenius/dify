"""Persistence contracts consumed by workflow execution and history readers."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from graphon.entities import WorkflowExecution, WorkflowNodeExecution


@dataclass
class OrderConfig:
    """Configuration for ordering node execution instances."""

    order_by: list[str]
    order_direction: Literal["asc", "desc"] | None = None


class WorkflowExecutionRepository(Protocol):
    """Accept complete run snapshots for eventual retrieval by the paired reader.

    Repeated saves of an ID update one logical run; readers and aggregates must
    expose its latest values once accepted asynchronous work has been delivered.
    Dispatch/persistence errors must propagate to the caller.
    """

    def save(self, execution: WorkflowExecution) -> None: ...


class WorkflowNodeExecutionRepository(Protocol):
    """Execution log writes and history, plus synchronous caller control state.

    `save` accepts lifecycle snapshots; after delivery, a fresh repository sees
    the latest progress. Delayed/repeated snapshots must not undo that progress
    or overwrite data persisted by `save_execution_data`. A resumed node retains
    its ID with a new start time.
    `save_execution_data` persists changed inputs/process data/outputs and cannot
    be a no-op merely because an earlier save contained a previous payload.
    `get_by_workflow_execution` excludes paused nodes and respects ordering.
    `save_synchronously` durably creates the relational caller row needed for
    participant allocation, independently of the selected execution-log backend.
    """

    def save(self, execution: WorkflowNodeExecution) -> None: ...

    def save_synchronously(self, execution: WorkflowNodeExecution) -> None: ...

    def save_execution_data(self, execution: WorkflowNodeExecution) -> None: ...

    def get_by_workflow_execution(
        self,
        workflow_execution_id: str,
        order_config: OrderConfig | None = None,
    ) -> Sequence[WorkflowNodeExecution]: ...
