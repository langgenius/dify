from collections.abc import Sequence
from datetime import datetime
from unittest.mock import Mock

from core.app.layers.conversation_variable_persist_layer import ConversationVariablePersistenceLayer
from core.variables import StringVariable
from core.variables.segments import Segment, StringSegment
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from core.workflow.enums import NodeType, SystemVariableKey, WorkflowNodeExecutionStatus
from core.workflow.graph_engine.protocols.command_channel import CommandChannel
from core.workflow.graph_events.node import NodeRunSucceededEvent
from core.workflow.node_events import NodeRunResult
from core.workflow.runtime.graph_runtime_state_protocol import ReadOnlyGraphRuntimeState


class MockReadOnlyVariablePool:
    def __init__(self, variables: dict[tuple[str, str], Segment] | None = None) -> None:
        self._variables = variables or {}

    def get(self, selector: Sequence[str]) -> Segment | None:
        if len(selector) < 2:
            return None
        return self._variables.get((selector[0], selector[1]))

    def get_all_by_node(self, node_id: str) -> dict[str, object]:
        return {key: value for (nid, key), value in self._variables.items() if nid == node_id}

    def get_by_prefix(self, prefix: str) -> dict[str, object]:
        return {key: value for (nid, key), value in self._variables.items() if nid == prefix}


def _build_graph_runtime_state(variable_pool: MockReadOnlyVariablePool) -> ReadOnlyGraphRuntimeState:
    graph_runtime_state = Mock(spec=ReadOnlyGraphRuntimeState)
    graph_runtime_state.variable_pool = variable_pool
    return graph_runtime_state


def _build_node_run_succeeded_event(
    *,
    node_type: NodeType,
    outputs: dict[str, object] | None = None,
    process_data: dict[str, object] | None = None,
) -> NodeRunSucceededEvent:
    return NodeRunSucceededEvent(
        id="node-exec-id",
        node_id="assigner",
        node_type=node_type,
        start_at=datetime.utcnow(),
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs=outputs or {},
            process_data=process_data or {},
        ),
    )


def test_persists_conversation_variables_from_assigner_output():
    conversation_id = "conv-123"
    variable = StringVariable(
        id="var-1",
        name="name",
        value="updated",
        selector=[CONVERSATION_VARIABLE_NODE_ID, "name"],
    )
    outputs = {".".join(variable.selector): variable.value}

    variable_pool = MockReadOnlyVariablePool(
        {
            (SYSTEM_VARIABLE_NODE_ID, SystemVariableKey.CONVERSATION_ID): StringSegment(value=conversation_id),
            (CONVERSATION_VARIABLE_NODE_ID, "name"): variable,
        }
    )

    updater = Mock()
    layer = ConversationVariablePersistenceLayer(updater)
    layer.initialize(_build_graph_runtime_state(variable_pool), Mock(spec=CommandChannel))

    event = _build_node_run_succeeded_event(node_type=NodeType.VARIABLE_ASSIGNER, outputs=outputs)
    layer.on_event(event)

    updater.update.assert_called_once_with(conversation_id=conversation_id, variable=variable)
    updater.flush.assert_called_once()


def test_skips_when_outputs_missing():
    conversation_id = "conv-456"
    variable = StringVariable(
        id="var-2",
        name="name",
        value="updated",
        selector=[CONVERSATION_VARIABLE_NODE_ID, "name"],
    )

    variable_pool = MockReadOnlyVariablePool(
        {
            (SYSTEM_VARIABLE_NODE_ID, SystemVariableKey.CONVERSATION_ID): StringSegment(value=conversation_id),
            (CONVERSATION_VARIABLE_NODE_ID, "name"): variable,
        }
    )

    updater = Mock()
    layer = ConversationVariablePersistenceLayer(updater)
    layer.initialize(_build_graph_runtime_state(variable_pool), Mock(spec=CommandChannel))

    event = _build_node_run_succeeded_event(node_type=NodeType.VARIABLE_ASSIGNER)
    layer.on_event(event)

    updater.update.assert_not_called()
    updater.flush.assert_not_called()


def test_skips_non_assigner_nodes():
    updater = Mock()
    layer = ConversationVariablePersistenceLayer(updater)
    layer.initialize(_build_graph_runtime_state(MockReadOnlyVariablePool()), Mock(spec=CommandChannel))

    event = _build_node_run_succeeded_event(node_type=NodeType.LLM)
    layer.on_event(event)

    updater.update.assert_not_called()
    updater.flush.assert_not_called()


def test_skips_non_conversation_variables():
    conversation_id = "conv-789"
    non_conversation_variable = StringVariable(
        id="var-3",
        name="name",
        value="updated",
        selector=["environment", "name"],
    )
    outputs = {".".join(non_conversation_variable.selector): non_conversation_variable.value}

    variable_pool = MockReadOnlyVariablePool(
        {
            (SYSTEM_VARIABLE_NODE_ID, SystemVariableKey.CONVERSATION_ID): StringSegment(value=conversation_id),
        }
    )

    updater = Mock()
    layer = ConversationVariablePersistenceLayer(updater)
    layer.initialize(_build_graph_runtime_state(variable_pool), Mock(spec=CommandChannel))

    event = _build_node_run_succeeded_event(node_type=NodeType.VARIABLE_ASSIGNER, outputs=outputs)
    layer.on_event(event)

    updater.update.assert_not_called()
    updater.flush.assert_not_called()
