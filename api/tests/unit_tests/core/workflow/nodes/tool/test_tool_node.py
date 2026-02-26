from unittest.mock import MagicMock

import pytest

from core.model_runtime.entities.llm_entities import LLMUsage
from core.plugin.impl.exc import PluginDaemonClientSideError, PluginInvokeError
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.tools.errors import ToolInvokeError
from core.variables import ArrayAnySegment
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.file import File, FileTransferMethod, FileType
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


def test_generate_parameters_sets_none_for_unknown_tool_parameter(tool_node, mock_variable_pool, mock_node_data):
    tool_input = MagicMock()
    tool_input.type = "constant"
    tool_input.value = "hello"
    mock_node_data.tool_parameters = {"p_missing": tool_input}

    result = tool_node._generate_parameters(
        tool_parameters=[],
        variable_pool=mock_variable_pool,
        node_data=mock_node_data,
    )

    assert result == {"p_missing": None}


def test_generate_parameters_constant_uses_text_for_non_log(tool_node, mock_variable_pool, mock_node_data):
    param = MagicMock(spec=ToolParameter)
    param.name = "p1"
    param.required = False

    tool_input = MagicMock()
    tool_input.type = "constant"
    tool_input.value = "template"
    mock_node_data.tool_parameters = {"p1": tool_input}

    result = tool_node._generate_parameters(
        tool_parameters=[param],
        variable_pool=mock_variable_pool,
        node_data=mock_node_data,
        for_log=False,
    )

    assert result == {"p1": "text_value"}


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


def test_fetch_files_reads_sys_files(tool_node):
    pool = MagicMock()
    pool.get.return_value = ArrayAnySegment(value=["f1", "f2"])

    result = tool_node._fetch_files(pool)

    assert result == ["f1", "f2"]


def test_extract_variable_selector_to_variable_mapping():
    mapping = ToolNode._extract_variable_selector_to_variable_mapping(
        graph_config={},
        node_id="node-x",
        node_data={
            "title": "Tool",
            "provider_id": "provider-id",
            "provider_type": "builtin",
            "provider_name": "Provider",
            "tool_name": "search",
            "tool_label": "Search",
            "tool_configurations": {},
            "tool_parameters": {
                "mixed_param": {"type": "mixed", "value": "hello {{#start.query#}}"},
                "variable_param": {"type": "variable", "value": ["answer", "text"]},
                "constant_param": {"type": "constant", "value": "fixed"},
            },
        },
    )

    assert mapping["node-x.#start.query#"] == ["start", "query"]
    assert mapping["node-x.#answer.text#"] == ["answer", "text"]
    assert "node-x.constant_param" not in mapping


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


def test_transform_message_file_invalid_meta_type(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.FILE
    msg.meta = {"file": "invalid-file"}

    mocker.patch(
        "core.workflow.nodes.tool.tool_node.ToolFileMessageTransformer.transform_tool_invoke_messages",
        return_value=[msg],
    )

    with pytest.raises(ToolNodeError, match="Expected File object"):
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


def test_transform_message_image_link_builds_file_output(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.IMAGE_LINK
    msg.message = ToolInvokeMessage.TextMessage(text="https://example.com/tool-file-id.png")
    msg.meta = {}

    tool_file = MagicMock()
    tool_file.mimetype = "image/png"

    built_file = File(
        id="f1",
        tenant_id="t",
        type=FileType.IMAGE,
        filename="f1.png",
        extension=".png",
        transfer_method=FileTransferMethod.TOOL_FILE,
        related_id="f1",
        storage_key="k",
    )

    session_cm = mocker.MagicMock()
    session_cm.__enter__.return_value.scalar.return_value = tool_file
    mocker.patch("core.workflow.nodes.tool.tool_node.db", mocker.MagicMock(engine=object()))
    mocker.patch("core.workflow.nodes.tool.tool_node.Session", return_value=session_cm)
    mocker.patch(
        "core.workflow.nodes.tool.tool_node.file_factory.get_file_type_by_mime_type", return_value=FileType.IMAGE
    )
    mocker.patch("core.workflow.nodes.tool.tool_node.file_factory.build_from_mapping", return_value=built_file)
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
    assert completed.node_run_result.outputs["files"].value == [built_file]


def test_transform_message_blob_builds_file_output(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.BLOB
    msg.message = ToolInvokeMessage.TextMessage(text="https://example.com/blob-file-id.bin")
    msg.meta = {"ok": True}

    tool_file = MagicMock()
    built_file = File(
        id="f2",
        tenant_id="t",
        type=FileType.IMAGE,
        filename="f2.png",
        extension=".png",
        transfer_method=FileTransferMethod.TOOL_FILE,
        related_id="f2",
        storage_key="k",
    )

    session_cm = mocker.MagicMock()
    session_cm.__enter__.return_value.scalar.return_value = tool_file
    mocker.patch("core.workflow.nodes.tool.tool_node.db", mocker.MagicMock(engine=object()))
    mocker.patch("core.workflow.nodes.tool.tool_node.Session", return_value=session_cm)
    mocker.patch("core.workflow.nodes.tool.tool_node.file_factory.build_from_mapping", return_value=built_file)
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
    assert completed.node_run_result.outputs["files"].value == [built_file]


def test_transform_message_json_and_plain_link(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    json_msg = MagicMock()
    json_msg.type = ToolInvokeMessage.MessageType.JSON
    json_msg.message = ToolInvokeMessage.JsonMessage(json_object={"k": 1})

    link_msg = MagicMock()
    link_msg.type = ToolInvokeMessage.MessageType.LINK
    link_msg.message = ToolInvokeMessage.TextMessage(text="https://example.com")
    link_msg.meta = None

    mocker.patch(
        "core.workflow.nodes.tool.tool_node.ToolFileMessageTransformer.transform_tool_invoke_messages",
        return_value=[json_msg, link_msg],
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
    assert completed.node_run_result.outputs["text"] == "Link: https://example.com\n"
    assert completed.node_run_result.outputs["json"] == [{"k": 1}]


def test_transform_message_variable_stream_requires_string_value(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.VARIABLE
    msg.message = ToolInvokeMessage.VariableMessage(variable_name="v", variable_value="ok", stream=True)
    msg.message.variable_value = 1

    mocker.patch(
        "core.workflow.nodes.tool.tool_node.ToolFileMessageTransformer.transform_tool_invoke_messages",
        return_value=[msg],
    )

    with pytest.raises(ToolNodeError, match="must be a string"):
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


def test_transform_message_log_enriches_metadata_with_icons(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    log_message = ToolInvokeMessage.LogMessage(
        id="1",
        label="label",
        status=ToolInvokeMessage.LogMessage.LogStatus.START,
        data={},
        metadata={"provider": "plugin-id/plugin-name"},
    )
    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.LOG
    msg.message = log_message

    plugin = MagicMock()
    plugin.plugin_id = "plugin-id"
    plugin.name = "plugin-name"
    plugin.declaration.icon = "plugin-icon"

    builtin_provider = MagicMock()
    builtin_provider.name = "plugin-id/plugin-name"
    builtin_provider.icon = "builtin-icon"
    builtin_provider.icon_dark = "builtin-icon-dark"

    installer = MagicMock()
    installer.list_plugins.return_value = [plugin]
    mocker.patch("core.plugin.impl.plugin.PluginInstaller", return_value=installer)
    mocker.patch(
        "core.workflow.nodes.tool.tool_node.BuiltinToolManageService.list_builtin_tools",
        return_value=[builtin_provider],
    )
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

    _ = next(e for e in events if isinstance(e, StreamCompletedEvent))
    assert msg.message.metadata["icon"] == "builtin-icon"
    assert msg.message.metadata["icon_dark"] == "builtin-icon-dark"


def test_transform_message_link_with_file_metadata(tool_node, mocker):
    runtime = MagicMock()
    runtime.latest_usage = LLMUsage.empty_usage()

    file_obj = File(
        id="f1",
        tenant_id="tenant",
        type=FileType.IMAGE,
        filename="img.png",
        extension=".png",
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="f1",
        storage_key="k",
    )

    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.LINK
    msg.message = ToolInvokeMessage.TextMessage(text="https://example.com/f1")
    msg.meta = {"file": file_obj}

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
    assert completed.node_run_result.outputs["text"].startswith("File: ")
    assert completed.node_run_result.outputs["files"].value == [file_obj]


def test_transform_message_includes_usage_metadata_when_tokens_present(tool_node, mocker):
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 10
    usage.total_price = 1
    usage.currency = "USD"
    runtime = MagicMock()
    runtime.latest_usage = usage

    msg = MagicMock()
    msg.type = ToolInvokeMessage.MessageType.TEXT
    msg.message = ToolInvokeMessage.TextMessage(text="done")

    mocker.patch(
        "core.workflow.nodes.tool.tool_node.ToolFileMessageTransformer.transform_tool_invoke_messages",
        return_value=[msg],
    )

    events = list(
        tool_node._transform_message(
            messages=[],
            tool_info={"provider_type": "builtin"},
            parameters_for_log={"a": "b"},
            user_id="u",
            tenant_id="t",
            node_id="node1",
            tool_runtime=runtime,
        )
    )

    completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
    metadata = completed.node_run_result.metadata
    assert metadata is not None
    assert metadata["total_tokens"] == 10
    assert metadata["currency"] == "USD"


def test_run_returns_failed_when_get_runtime_raises_tool_node_error(tool_node, mocker):
    mocker.patch(
        "core.tools.tool_manager.ToolManager.get_workflow_tool_runtime",
        side_effect=ToolNodeError("runtime-error"),
    )

    events = list(tool_node._run())

    completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
    assert completed.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert "Failed to get tool runtime" in (completed.node_run_result.error or "")


def test_run_returns_failed_when_tool_engine_raises_tool_node_error(tool_node, mocker):
    runtime = MagicMock()
    runtime.get_merged_runtime_parameters.return_value = []
    mocker.patch("core.tools.tool_manager.ToolManager.get_workflow_tool_runtime", return_value=runtime)
    mocker.patch.object(tool_node, "_generate_parameters", return_value={})
    mocker.patch("core.workflow.nodes.tool.tool_node.ToolEngine.generic_invoke", side_effect=ToolNodeError("invoke"))

    events = list(tool_node._run())

    completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
    assert completed.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert "Failed to invoke tool:" in (completed.node_run_result.error or "")


def test_run_uses_variable_pool_for_new_tool_node_versions(tool_node, mocker):
    runtime = MagicMock()
    runtime.get_merged_runtime_parameters.return_value = []
    tool_node.node_data.version = "2"

    get_runtime = mocker.patch("core.tools.tool_manager.ToolManager.get_workflow_tool_runtime", return_value=runtime)
    mocker.patch.object(tool_node, "_generate_parameters", return_value={})
    mocker.patch("core.workflow.nodes.tool.tool_node.ToolEngine.generic_invoke", return_value=iter([]))
    mocker.patch.object(tool_node, "_transform_message", side_effect=ToolInvokeError("invoke-failed"))

    list(tool_node._run())

    assert get_runtime.call_args.args[-1] is tool_node.graph_runtime_state.variable_pool


def test_run_returns_failed_when_transform_message_raises_tool_invoke_error(tool_node, mocker):
    runtime = MagicMock()
    runtime.get_merged_runtime_parameters.return_value = []
    mocker.patch("core.tools.tool_manager.ToolManager.get_workflow_tool_runtime", return_value=runtime)
    mocker.patch.object(tool_node, "_generate_parameters", return_value={})
    mocker.patch("core.workflow.nodes.tool.tool_node.ToolEngine.generic_invoke", return_value=iter([]))
    mocker.patch.object(tool_node, "_transform_message", side_effect=ToolInvokeError("invoke-failed"))

    events = list(tool_node._run())

    completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
    assert completed.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert "Failed to invoke tool provider" in (completed.node_run_result.error or "")


def test_run_returns_failed_when_transform_message_raises_plugin_invoke_error(tool_node, mocker):
    runtime = MagicMock()
    runtime.get_merged_runtime_parameters.return_value = []
    mocker.patch("core.tools.tool_manager.ToolManager.get_workflow_tool_runtime", return_value=runtime)
    mocker.patch.object(tool_node, "_generate_parameters", return_value={})
    mocker.patch("core.workflow.nodes.tool.tool_node.ToolEngine.generic_invoke", return_value=iter([]))
    mocker.patch.object(tool_node, "_transform_message", side_effect=PluginInvokeError('{"message":"bad"}'))

    events = list(tool_node._run())

    completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
    assert completed.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert completed.node_run_result.error_type == "PluginInvokeError"


def test_run_returns_failed_when_transform_message_raises_plugin_daemon_error(tool_node, mocker):
    runtime = MagicMock()
    runtime.get_merged_runtime_parameters.return_value = []
    mocker.patch("core.tools.tool_manager.ToolManager.get_workflow_tool_runtime", return_value=runtime)
    mocker.patch.object(tool_node, "_generate_parameters", return_value={})
    mocker.patch("core.workflow.nodes.tool.tool_node.ToolEngine.generic_invoke", return_value=iter([]))
    mocker.patch.object(tool_node, "_transform_message", side_effect=PluginDaemonClientSideError("daemon"))

    events = list(tool_node._run())

    completed = next(e for e in events if isinstance(e, StreamCompletedEvent))
    assert completed.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert "Failed to invoke tool, error: daemon" in (completed.node_run_result.error or "")


# ==========================================================
# retry Property Test
# ==========================================================


def test_retry_property(tool_node):
    assert tool_node.retry is True
