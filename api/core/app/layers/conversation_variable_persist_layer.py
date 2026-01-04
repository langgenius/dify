import logging

from core.variables import Variable
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from core.workflow.conversation_variable_updater import ConversationVariableUpdater
from core.workflow.enums import NodeType, SystemVariableKey
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events import GraphEngineEvent, NodeRunSucceededEvent

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

        outputs = event.node_run_result.outputs
        if not outputs:
            return
        selector_keys = [key for key in outputs.keys() if key.startswith(f"{CONVERSATION_VARIABLE_NODE_ID}.")]
        if not selector_keys:
            return

        conversation_id = self._get_conversation_id()
        if conversation_id is None:
            return

        for selector_key in selector_keys:
            selector = selector_key.split(".")
            if len(selector) < 2:
                logger.warning("Conversation variable selector invalid. selector=%s", selector_key)
                continue
            variable = self.graph_runtime_state.variable_pool.get(selector)
            if not isinstance(variable, Variable):
                logger.warning(
                    "Conversation variable not found in variable pool. selector=%s",
                    selector[:2],
                )
                continue
            self._conversation_variable_updater.update(conversation_id=conversation_id, variable=variable)

        self._conversation_variable_updater.flush()

    def on_graph_end(self, error: Exception | None) -> None:
        pass

    def _get_conversation_id(self) -> str | None:
        assert self.graph_runtime_state is not None
        segment = self.graph_runtime_state.variable_pool.get(
            [SYSTEM_VARIABLE_NODE_ID, SystemVariableKey.CONVERSATION_ID]
        )
        if segment is None:
            return None
        return str(segment.value)
