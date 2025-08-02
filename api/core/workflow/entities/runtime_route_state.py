from datetime import UTC, datetime

from pydantic import BaseModel, Field

from .route_node_state import RouteNodeState


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
