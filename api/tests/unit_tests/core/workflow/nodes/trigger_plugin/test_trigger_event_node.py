from __future__ import annotations

from unittest.mock import Mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.entities.common_entities import I18nObject
from core.trigger.entities.entities import EventParameter, EventParameterType
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities import GraphInitParams
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from core.workflow.nodes.trigger_plugin.exc import TriggerEventParameterError
from core.workflow.nodes.trigger_plugin.trigger_event_node import TriggerEventNode
from models.enums import UserFrom


@pytest.fixture
def graph_init_params() -> GraphInitParams:
    return GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config={},
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )


def test_trigger_event_node_run_metadata_and_inputs(graph_init_params: GraphInitParams) -> None:
    variable_pool = Mock()
    variable_pool.user_inputs = {"input_key": "input_value"}
    system_variables = Mock()
    system_variables.to_dict.return_value = {"sys_key": "sys_val"}
    variable_pool.system_variables = system_variables

    graph_runtime_state = Mock()
    graph_runtime_state.variable_pool = variable_pool

    node_config = {
        "id": "node-1",
        "data": {
            "title": "Trigger",
            "plugin_id": "plugin",
            "provider_id": "provider",
            "event_name": "event",
            "subscription_id": "sub",
            "plugin_unique_identifier": "plugin.unique",
            "event_parameters": {},
        },
    }

    node = TriggerEventNode(
        id="node-1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.inputs["input_key"] == "input_value"
    assert result.inputs[f"{SYSTEM_VARIABLE_NODE_ID}.sys_key"] == "sys_val"
    assert result.outputs == result.inputs
    assert result.metadata == {
        WorkflowNodeExecutionMetadataKey.TRIGGER_INFO: {
            "provider_id": "provider",
            "event_name": "event",
            "plugin_unique_identifier": "plugin.unique",
        }
    }


def test_trigger_event_node_resolve_parameters_constant() -> None:
    node_data = TriggerEventNodeData.model_validate(
        {
            "title": "Trigger",
            "plugin_id": "plugin",
            "provider_id": "provider",
            "event_name": "event",
            "subscription_id": "sub",
            "plugin_unique_identifier": "plugin.unique",
            "event_parameters": {
                "count": {"value": "42", "type": "constant"},
                "missing": {"value": "x", "type": "constant"},
            },
        }
    )

    parameter = EventParameter(
        name="count",
        label=I18nObject(en_US="Count"),
        type=EventParameterType.STRING,
    )

    result = node_data.resolve_parameters(parameter_schemas={"count": parameter})

    assert result == {"count": "42", "missing": None}


def test_trigger_event_node_resolve_parameters_rejects_non_constant() -> None:
    node_data = TriggerEventNodeData.model_validate(
        {
            "title": "Trigger",
            "plugin_id": "plugin",
            "provider_id": "provider",
            "event_name": "event",
            "subscription_id": "sub",
            "plugin_unique_identifier": "plugin.unique",
            "event_parameters": {
                "count": {"value": ["var", "path"], "type": "variable"},
            },
        }
    )

    parameter = EventParameter(
        name="count",
        label=I18nObject(en_US="Count"),
        type=EventParameterType.STRING,
    )

    with pytest.raises(TriggerEventParameterError, match="Unknown plugin trigger input type"):
        node_data.resolve_parameters(parameter_schemas={"count": parameter})


def test_trigger_event_input_validation_rejects_mixed_non_string() -> None:
    with pytest.raises(ValueError, match="value must be a string"):
        TriggerEventNodeData.model_validate(
            {
                "title": "Trigger",
                "plugin_id": "plugin",
                "provider_id": "provider",
                "event_name": "event",
                "subscription_id": "sub",
                "plugin_unique_identifier": "plugin.unique",
                "event_parameters": {"payload": {"value": ["x"], "type": "mixed"}},
            }
        )
