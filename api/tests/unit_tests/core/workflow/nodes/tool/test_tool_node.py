from unittest.mock import MagicMock

import pytest

from core.model_runtime.entities.llm_entities import LLMUsage
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.node_events import StreamChunkEvent, StreamCompletedEvent
from core.workflow.nodes.tool.exc import ToolNodeError, ToolParameterError
from core.workflow.nodes.tool.tool_node import ToolNode

# ==========================================================
# Fixtures
# ==========================================================


@pytest.fixture
def mock_variable_pool(mocker):
    pool = mocker.MagicMock()

    pool.get.return_value = None

    segment = mocker.MagicMock()
    segment.text = "text_value"
    segment.log = "log_value"

    pool.convert_template.return_value = segment
    return pool


@pytest.fixture
def mock_node_data(mocker):
    retry_config = mocker.MagicMock()
    retry_config.retry_enabled = True

    node_data = mocker.MagicMock()
    node_data.provider_type.value = "mock_provider"
    node_data.provider_id = "pid"
    node_data.plugin_unique_identifier = "uid"
    node_data.provider_name = "provider"
    node_data.version = "1"
    node_data.tool_node_version = None
    node_data.tool_parameters = {}
    node_data.retry_config = retry_config
    return node_data


@pytest.fixture
def tool_node(mock_node_data, mock_variable_pool, mocker):
    node = ToolNode.__new__(ToolNode)

    # IMPORTANT: set private attribute instead of property
    node._node_data = mock_node_data

    node._node_id = "node1"
    node.user_id = "user1"
    node.tenant_id = "tenant1"
    node.app_id = "app1"
    node.workflow_call_depth = 0
    node.invoke_from = None

    node.graph_runtime_state = mocker.MagicMock()
    node.graph_runtime_state.variable_pool = mock_variable_pool

    return node


# ==========================================================
# _generate_parameters Tests
# ==========================================================


@pytest.mark.parametrize(
    ("required", "variable_exists"),
    [
        (True, True),
        (False, False),
    ],
)
def test_generate_parameters_variable(tool_node, mock_variable_pool, mock_node_data, required, variable_exists):
    param = MagicMock(spec=ToolParameter)
    param.name = "p1"
    param.required = required

    tool_input = MagicMock()
    tool_input.type = "variable"
    tool_input.value = ["a"]

    mock_node_data.tool_parameters = {"p1": tool_input}

    if variable_exists:
        mock_var = MagicMock()
        mock_var.value = "value"
        mock_variable_pool.get.return_value = mock_var
    else:
        mock_variable_pool.get.return_value = None

    if required and not variable_exists:
        with pytest.raises(ToolParameterError):
            tool_node._generate_parameters(
                tool_parameters=[param],
                variable_pool=mock_variable_pool,
                node_data=mock_node_data,
            )
    else:
        result = tool_node._generate_parameters(
            tool_parameters=[param],
            variable_pool=mock_variable_pool,
            node_data=mock_node_data,
        )
        if variable_exists:
            assert result["p1"] == "value"


def test_generate_parameters_mixed_for_log(tool_node, mock_variable_pool, mock_node_data):
    param = MagicMock(spec=ToolParameter)
    param.name = "p1"
    param.required = False

    tool_input = MagicMock()
    tool_input.type = "mixed"
    tool_input.value = "template"

    mock_node_data.tool_parameters = {"p1": tool_input}

    result = tool_node._generate_parameters(
        tool_parameters=[param],
        variable_pool=mock_variable_pool,
        node_data=mock_node_data,
        for_log=True,
    )

    assert result["p1"] == "log_value"


def test_generate_parameters_unknown_type(tool_node, mock_variable_pool, mock_node_data):
    param = MagicMock(spec=ToolParameter)
    param.name = "p1"
    param.required = False

    tool_input = MagicMock()
    tool_input.type = "invalid"

    mock_node_data.tool_parameters = {"p1": tool_input}

    with pytest.raises(ToolParameterError):
        tool_node._generate_parameters(
            tool_parameters=[param],
            variable_pool=mock_variable_pool,
            node_data=mock_node_data,
        )


# ==========================================================
# _extract_tool_usage Tests
# ==========================================================


@pytest.mark.parametrize(
    "latest",
    [
        LLMUsage.empty_usage(),
        LLMUsage.empty_usage().model_dump(),
        None,
    ],
)
def test_extract_tool_usage(latest):
    runtime = MagicMock()
    runtime.latest_usage = latest

    usage = ToolNode._extract_tool_usage(runtime)

    assert isinstance(usage, LLMUsage)


# ==========================================================
# _transform_message Tests (FIXED WITH REAL MESSAGE TYPES)
# ==========================================================


def test_transform_message_text(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    # Use real TextMessage
    text_message = ToolInvokeMessage.TextMessage(text="hello")

    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.TEXT
    msg.message = text_message

    mocker.patch(
        "core.workflow.nodes.tool.tool_node.ToolFileMessageTransformer.transform_tool_invoke_messages",
        return_value=[msg],
    )

    events = list(
        tool_node._transform_message(
            messages=[],
            tool_info={},
            parameters_for_log={},
            user_id="u",
            tenant_id="t",
            node_id="node1",
            tool_runtime=runtime,
        )
    )

    assert any(isinstance(e, StreamChunkEvent) for e in events)
    completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
    assert completed.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert completed.node_run_result.outputs["text"] == "hello"


def test_transform_message_variable_stream_success(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    variable_message = ToolInvokeMessage.VariableMessage(
        variable_name="v1",
        variable_value="hello",
        stream=True,
    )

    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.VARIABLE
    msg.message = variable_message

    mocker.patch(
        "core.workflow.nodes.tool.tool_node.ToolFileMessageTransformer.transform_tool_invoke_messages",
        return_value=[msg],
    )

    events = list(
        tool_node._transform_message(
            messages=[],
            tool_info={},
            parameters_for_log={},
            user_id="u",
            tenant_id="t",
            node_id="node1",
            tool_runtime=runtime,
        )
    )

    # Should emit chunk event for variable
    chunk_events = [e for e in events if isinstance(e, StreamChunkEvent)]
    assert any(e.selector == ["node1", "v1"] for e in chunk_events)

    completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
    assert completed.node_run_result.outputs["v1"] == "hello"


def test_transform_message_variable_non_stream_any_type(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    # Non-stream mode allows any type
    variable_message = ToolInvokeMessage.VariableMessage(
        variable_name="v1",
        variable_value=123,
        stream=False,
    )

    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.VARIABLE
    msg.message = variable_message

    mocker.patch(
        "core.workflow.nodes.tool.tool_node.ToolFileMessageTransformer.transform_tool_invoke_messages",
        return_value=[msg],
    )

    events = list(
        tool_node._transform_message(
            messages=[],
            tool_info={},
            parameters_for_log={},
            user_id="u",
            tenant_id="t",
            node_id="node1",
            tool_runtime=runtime,
        )
    )

    completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
    assert completed.node_run_result.outputs["v1"] == 123


def test_transform_message_file_missing_meta(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.FILE
    msg.meta = {}

    mocker.patch(
        "core.workflow.nodes.tool.tool_node.ToolFileMessageTransformer.transform_tool_invoke_messages",
        return_value=[msg],
    )

    with pytest.raises(ToolNodeError):
        list(
            tool_node._transform_message(
                messages=[],
                tool_info={},
                parameters_for_log={},
                user_id="u",
                tenant_id="t",
                node_id="node1",
                tool_runtime=runtime,
            )
        )


# ==========================================================
# retry Property Test
# ==========================================================


def test_retry_property(tool_node):
    assert tool_node.retry is True
