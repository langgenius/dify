from unittest.mock import Mock

from core.app.layers.conversation_variable_persist_layer import ConversationVariablePersistenceLayer
from core.workflow.system_variables import build_system_variables
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import NodeRunSucceededEvent, NodeRunVariableUpdatedEvent
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult
from graphon.runtime import ReadOnlyRuntimeStateWrapper, RuntimeState, VariablePool
from graphon.variables import StringVariable
from libs.datetime_utils import naive_utc_now


def _build_graph_runtime_state(conversation_id: str) -> ReadOnlyRuntimeStateWrapper:
    return ReadOnlyRuntimeStateWrapper(
        RuntimeState(
            workflow_id="workflow-1",
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(conversation_id=conversation_id)
            ),
            start_at=0,
        )
    )


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
    layer.initialize(_build_graph_runtime_state(conversation_id), InMemoryChannel())

    event = _build_variable_updated_event(variable)
    layer.on_event(event)

    updater.update.assert_called_once_with(conversation_id=conversation_id, variable=variable)


def test_skips_non_variable_update_events():
    conversation_id = "conv-456"
    updater = Mock()
    layer = ConversationVariablePersistenceLayer(updater)
    layer.initialize(_build_graph_runtime_state(conversation_id), InMemoryChannel())

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
    layer.initialize(_build_graph_runtime_state(conversation_id), InMemoryChannel())

    event = _build_variable_updated_event(non_conversation_variable)
    layer.on_event(event)

    updater.update.assert_not_called()
