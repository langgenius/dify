import uuid
from datetime import UTC, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from core.workflow.entities.node_entities import NodeRunResult
from models.workflow import WorkflowNodeExecutionStatus


class RouteNodeState(BaseModel):
    class Status(Enum):
        RUNNING = "running"
        SUCCESS = "success"
        FAILED = "failed"
        PAUSED = "paused"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    """node state id"""

    node_id: str
    """node id"""

    node_run_result: Optional[NodeRunResult] = None
    """node run result"""

    status: Status = Status.RUNNING
    """node status"""

    start_at: datetime
    """start time"""

    paused_at: Optional[datetime] = None
    """paused time"""

    finished_at: Optional[datetime] = None
    """finished time"""

    failed_reason: Optional[str] = None
    """failed reason"""

    paused_by: Optional[str] = None
    """paused by"""

    index: int = 1

    def set_finished(self, run_result: NodeRunResult) -> None:
        """
        Node finished

        :param run_result: run result
        """
        if self.status in {RouteNodeState.Status.SUCCESS, RouteNodeState.Status.FAILED}:
            raise Exception(f"Route state {self.id} already finished")

        if run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED:
            self.status = RouteNodeState.Status.SUCCESS
        elif run_result.status == WorkflowNodeExecutionStatus.FAILED:
            self.status = RouteNodeState.Status.FAILED
            self.failed_reason = run_result.error
        else:
            raise Exception(f"Invalid route status {run_result.status}")

        self.node_run_result = run_result
        self.finished_at = datetime.now(UTC).replace(tzinfo=None)


class RuntimeRouteState(BaseModel):
    routes: dict[str, list[str]] = Field(
        default_factory=dict, description="graph state routes (source_node_state_id: target_node_state_id)"
    )

    node_state_mapping: dict[str, RouteNodeState] = Field(
        default_factory=dict, description="node state mapping (route_node_state_id: route_node_state)"
    )

    def create_node_state(self, node_id: str) -> RouteNodeState:
        """
        Create node state

        :param node_id: node id
        """
        state = RouteNodeState(node_id=node_id, start_at=datetime.now(UTC).replace(tzinfo=None))
        self.node_state_mapping[state.id] = state
        return state

    def add_route(self, source_node_state_id: str, target_node_state_id: str) -> None:
        """
        Add route to the graph state

        :param source_node_state_id: source node state id
        :param target_node_state_id: target node state id
        """
        if source_node_state_id not in self.routes:
            self.routes[source_node_state_id] = []

        self.routes[source_node_state_id].append(target_node_state_id)

    def get_routes_with_node_state_by_source_node_state_id(self, source_node_state_id: str) -> list[RouteNodeState]:
        """
        Get routes with node state by source node id

        :param source_node_state_id: source node state id
        :return: routes with node state
        """
        return [
            self.node_state_mapping[target_state_id] for target_state_id in self.routes.get(source_node_state_id, [])
        ]
