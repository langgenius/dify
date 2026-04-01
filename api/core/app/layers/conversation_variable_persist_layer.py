"""
Persist conversation-scoped variable updates emitted by the graph engine.

The graph package emits generic variable update events and stays unaware of
conversation identity or storage concerns. This layer lives in the application
core, listens to those generic events, and persists only the `conversation.*`
scope updates that matter to chat applications.
"""

import logging

from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent, NodeRunVariableUpdatedEvent

from core.workflow.system_variables import SystemVariableKey, get_system_text
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID
from services.conversation_variable_updater import ConversationVariableUpdater

logger = logging.getLogger(__name__)


class ConversationVariablePersistenceLayer(GraphEngineLayer):
    def __init__(self, conversation_variable_updater: ConversationVariableUpdater) -> None:
        super().__init__()
        self._conversation_variable_updater = conversation_variable_updater

    def on_graph_start(self) -> None:
        pass

    def on_event(self, event: GraphEngineEvent) -> None:
        if not isinstance(event, NodeRunVariableUpdatedEvent):
            return

        selector = event.variable.selector
        if len(selector) < 2:
            logger.warning("Conversation variable selector invalid. selector=%s", selector)
            return

        conversation_id = get_system_text(self.graph_runtime_state.variable_pool, SystemVariableKey.CONVERSATION_ID)
        if conversation_id is None:
            return

        if selector[0] != CONVERSATION_VARIABLE_NODE_ID:
            return

        self._conversation_variable_updater.update(conversation_id=conversation_id, variable=event.variable)

    def on_graph_end(self, error: Exception | None) -> None:
        pass
