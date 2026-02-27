import logging

from core.variables import VariableBase
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID
from core.workflow.conversation_variable_updater import ConversationVariableUpdater
from core.workflow.enums import NodeType
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events import GraphEngineEvent, NodeRunSucceededEvent
from core.workflow.nodes.variable_assigner.common import helpers as common_helpers

logger = logging.getLogger(__name__)


class ConversationVariablePersistenceLayer(GraphEngineLayer):
    def __init__(self, conversation_variable_updater: ConversationVariableUpdater) -> None:
        super().__init__()
        self._conversation_variable_updater = conversation_variable_updater

    def on_graph_start(self) -> None:
        pass

    def on_event(self, event: GraphEngineEvent) -> None:
        if not isinstance(event, NodeRunSucceededEvent):
            return
        if event.node_type != NodeType.VARIABLE_ASSIGNER:
            return
        if self.graph_runtime_state is None:
            return

        updated_variables = common_helpers.get_updated_variables(event.node_run_result.process_data) or []
        if not updated_variables:
            return

        conversation_id = self.graph_runtime_state.system_variable.conversation_id
        if conversation_id is None:
            return

        updated_any = False
        for item in updated_variables:
            selector = item.selector
            if len(selector) < 2:
                logger.warning("Conversation variable selector invalid. selector=%s", selector)
                continue
            if selector[0] != CONVERSATION_VARIABLE_NODE_ID:
                continue
            variable = self.graph_runtime_state.variable_pool.get(selector)
            if not isinstance(variable, VariableBase):
                logger.warning(
                    "Conversation variable not found in variable pool. selector=%s",
                    selector,
                )
                continue
            self._conversation_variable_updater.update(conversation_id=conversation_id, variable=variable)
            updated_any = True

        if updated_any:
            self._conversation_variable_updater.flush()

    def on_graph_end(self, error: Exception | None) -> None:
        pass
