from collections.abc import Sequence
from unittest.mock import Mock

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.graph_engine.command_channels import CommandChannel
from graphon.graph_events import NodeRunSucceededEvent, NodeRunVariableUpdatedEvent
from graphon.node_events import NodeRunResult
from graphon.runtime import ReadOnlyGraphRuntimeState
from graphon.variables import StringVariable
from graphon.variables.segments import Segment, StringSegment

from core.app.layers.conversation_variable_persist_layer import ConversationVariablePersistenceLayer
from core.workflow.system_variables import SystemVariableKey
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID
from libs.datetime_utils import naive_utc_now


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


def _build_graph_runtime_state(
    variable_pool: MockReadOnlyVariablePool,
    conversation_id: str | None = None,
) -> ReadOnlyGraphRuntimeState:
    graph_runtime_state = Mock(spec=ReadOnlyGraphRuntimeState)
    if conversation_id is not None:
        variable_pool._variables[("sys", SystemVariableKey.CONVERSATION_ID.value)] = StringSegment(
            value=conversation_id
        )
    graph_runtime_state.variable_pool = variable_pool
    return graph_runtime_state


def _build_node_run_succeeded_event() -> NodeRunSucceededEvent:
    return NodeRunSucceededEvent(
        id="node-exec-id",
        node_id="assigner",
        node_type=BuiltinNodeTypes.LLM,
        start_at=naive_utc_now(),
        node_run_result=NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={},
            process_data={},
        ),
    )


def _build_variable_updated_event(variable: StringVariable) -> NodeRunVariableUpdatedEvent:
    return NodeRunVariableUpdatedEvent(
        id="node-exec-id",
        node_id="assigner",
        node_type=BuiltinNodeTypes.VARIABLE_ASSIGNER,
        variable=variable,
    )


def test_persists_conversation_variables_from_variable_update_event():
    conversation_id = "conv-123"
    variable = StringVariable(
        id="var-1",
        name="name",
        value="updated",
        selector=[CONVERSATION_VARIABLE_NODE_ID, "name"],
    )
    updater = Mock()
    layer = ConversationVariablePersistenceLayer(updater)
    layer.initialize(_build_graph_runtime_state(MockReadOnlyVariablePool(), conversation_id), Mock(spec=CommandChannel))

    event = _build_variable_updated_event(variable)
    layer.on_event(event)

    updater.update.assert_called_once_with(conversation_id=conversation_id, variable=variable)


def test_skips_non_variable_update_events():
    conversation_id = "conv-456"
    updater = Mock()
    layer = ConversationVariablePersistenceLayer(updater)
    layer.initialize(_build_graph_runtime_state(MockReadOnlyVariablePool(), conversation_id), Mock(spec=CommandChannel))

    event = _build_node_run_succeeded_event()
    layer.on_event(event)

    updater.update.assert_not_called()


def test_skips_non_conversation_variables():
    conversation_id = "conv-789"
    non_conversation_variable = StringVariable(
        id="var-3",
        name="name",
        value="updated",
        selector=["environment", "name"],
    )
    updater = Mock()
    layer = ConversationVariablePersistenceLayer(updater)
    layer.initialize(_build_graph_runtime_state(MockReadOnlyVariablePool(), conversation_id), Mock(spec=CommandChannel))

    event = _build_variable_updated_event(non_conversation_variable)
    layer.on_event(event)

    updater.update.assert_not_called()
