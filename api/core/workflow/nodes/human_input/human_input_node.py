from collections.abc import Generator
from typing import override

from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.graph_events import (
    GraphNodeEventBase,
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunSucceededEvent,
)
from graphon.nodes.container_effects import ContainerAwaitRequest
from graphon.nodes.human_input.human_input_node import HumanInputNode

from .constants import OUTPUT_FIELD_ACTION_ID, OUTPUT_FIELD_ACTION_VALUE, OUTPUT_FIELD_RENDERED_CONTENT, TIMEOUT_HANDLE


class DifyHumanInputNode(HumanInputNode):
    """Preserve Dify's form lifecycle events around Graphon's HITL callback."""

    @override
    def run(self) -> Generator[GraphNodeEventBase | ContainerAwaitRequest, None, None]:
        for event in super().run():
            if isinstance(event, NodeRunSucceededEvent):
                # Emit before the engine processes success: it publishes taken
                # edges first, which can make response filters stream Answer text.
                # Reconstructing the form event in the app runner is too late.
                result = event.node_run_result
                if result.edge_source_handle == TIMEOUT_HANDLE:
                    # Forms are bound to node execution IDs, including in loops.
                    # Graphon's result does not carry the original form deadline.
                    form = HumanInputFormSubmissionRepository().get_by_form_id(event.id)
                    app_id = get_system_text(self.graph_runtime_state.variable_pool, SystemVariableKey.APP_ID)
                    if form is None or form.app_id != app_id or form.node_id != event.node_id:
                        raise ValueError(f"Cannot resolve timed-out human input form for node execution {event.id}")
                    yield NodeRunHumanInputFormTimeoutEvent(
                        id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=self.title,
                        expiration_time=form.expiration_time,
                    )
                else:
                    yield NodeRunHumanInputFormFilledEvent(
                        id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=self.title,
                        rendered_content=result.outputs[OUTPUT_FIELD_RENDERED_CONTENT].text,
                        action_id=result.outputs[OUTPUT_FIELD_ACTION_ID].text,
                        action_text=result.outputs[OUTPUT_FIELD_ACTION_VALUE].text,
                        submitted_data=result.inputs,
                    )
            yield event
