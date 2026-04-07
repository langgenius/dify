from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.nodes.tool.entities import ToolNodeData, ToolProviderType
from graphon.nodes.tool.exc import ToolRuntimeInvocationError
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle, ToolRuntimeMessage
from graphon.runtime import VariablePool

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.plugin.impl.exc import PluginDaemonClientSideError, PluginInvokeError
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.entities.tool_entities import ToolProviderType as CoreToolProviderType
from core.tools.errors import ToolInvokeError
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.node_runtime import DifyToolNodeRuntime
from core.workflow.system_variables import build_system_variables
from tests.workflow_test_utils import build_test_graph_init_params, build_test_variable_pool


@pytest.fixture
def runtime(monkeypatch) -> DifyToolNodeRuntime:
    module_name = "core.ops.ops_trace_manager"
    if module_name not in sys.modules:
        ops_stub = types.ModuleType(module_name)
        ops_stub.TraceQueueManager = object  # pragma: no cover - stub attribute
        ops_stub.TraceTask = object  # pragma: no cover - stub attribute
        monkeypatch.setitem(sys.modules, module_name, ops_stub)

    init_params = build_test_graph_init_params(
        workflow_id="workflow-id",
        graph_config={"nodes": [], "edges": []},
        tenant_id="tenant-id",
        app_id="app-id",
        user_id="user-id",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )
    return DifyToolNodeRuntime(init_params.run_context)


def _build_tool_node_data() -> ToolNodeData:
    return ToolNodeData.model_validate(
        {
            "type": "tool",
            "title": "Tool",
            "provider_id": "provider",
            "provider_type": ToolProviderType.BUILT_IN,
            "provider_name": "provider",
            "tool_name": "lookup",
            "tool_label": "Lookup",
            "tool_configurations": {},
            "tool_parameters": {},
        }
    )


def test_invoke_creates_callback_and_converts_messages(runtime: DifyToolNodeRuntime) -> None:
    core_message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.LINK,
        message=ToolInvokeMessage.TextMessage(text="https://dify.ai"),
        meta=None,
    )
    variable_pool: VariablePool = build_test_variable_pool(
        variables=build_system_variables(conversation_id="conversation-id")
    )
    workflow_tool = MagicMock()

    with (
        patch.object(ToolManager, "get_workflow_tool_runtime", return_value=workflow_tool),
        patch.object(ToolEngine, "generic_invoke", return_value=iter([core_message])) as generic_invoke_mock,
        patch.object(
            ToolFileMessageTransformer,
            "transform_tool_invoke_messages",
            side_effect=lambda *, messages, **_: messages,
        ) as transform_tool_messages,
    ):
        tool_runtime = runtime.get_runtime(
            node_id="node-id",
            node_data=_build_tool_node_data(),
            variable_pool=variable_pool,
        )
        messages = list(
            runtime.invoke(
                tool_runtime=tool_runtime,
                tool_parameters={},
                workflow_call_depth=0,
                provider_name="provider",
            )
        )

    assert not hasattr(tool_runtime, "conversation_id")
    assert len(messages) == 1
    graph_message = messages[0]
    assert graph_message.type == ToolRuntimeMessage.MessageType.LINK
    assert isinstance(graph_message.message, ToolRuntimeMessage.TextMessage)
    assert graph_message.message.text == "https://dify.ai"

    callback = generic_invoke_mock.call_args.kwargs["workflow_tool_callback"]
    assert isinstance(callback, DifyWorkflowCallbackHandler)
    assert generic_invoke_mock.call_args.kwargs["conversation_id"] == "conversation-id"

    transform_kwargs = transform_tool_messages.call_args.kwargs
    assert transform_kwargs["conversation_id"] == "conversation-id"


def test_invoke_maps_plugin_errors_to_graph_errors(runtime: DifyToolNodeRuntime) -> None:
    invoke_error = PluginInvokeError('{"error_type":"RateLimit","message":"too many"}')

    with patch.object(ToolEngine, "generic_invoke", side_effect=invoke_error):
        with pytest.raises(ToolRuntimeInvocationError, match="An error occurred in the provider"):
            runtime.invoke(
                tool_runtime=ToolRuntimeHandle(raw=MagicMock()),
                tool_parameters={},
                workflow_call_depth=0,
                provider_name="provider",
            )


def test_get_usage_normalizes_dict_payload(runtime: DifyToolNodeRuntime) -> None:
    usage_payload = LLMUsage.empty_usage().model_dump()
    usage_payload["total_tokens"] = 42

    usage = runtime.get_usage(
        tool_runtime=ToolRuntimeHandle(raw=SimpleNamespace(latest_usage=usage_payload)),
    )

    assert usage.total_tokens == 42


def test_get_runtime_converts_graph_provider_type_for_tool_manager(runtime: DifyToolNodeRuntime) -> None:
    node_data = _build_tool_node_data()

    with patch.object(ToolManager, "get_workflow_tool_runtime", return_value=MagicMock()) as runtime_mock:
        tool_runtime = runtime.get_runtime(node_id="node-id", node_data=node_data, variable_pool=None)

    assert not hasattr(tool_runtime, "conversation_id")
    workflow_tool = runtime_mock.call_args.args[3]
    assert workflow_tool.provider_type == CoreToolProviderType.BUILT_IN


def test_get_runtime_parameters_reads_required_flags(runtime: DifyToolNodeRuntime) -> None:
    tool_runtime = ToolRuntimeHandle(
        raw=SimpleNamespace(
            get_merged_runtime_parameters=MagicMock(
                return_value=[
                    SimpleNamespace(name="city", required=True),
                    SimpleNamespace(name="country", required=False),
                ]
            )
        )
    )

    parameters = runtime.get_runtime_parameters(tool_runtime=tool_runtime)

    assert [(parameter.name, parameter.required) for parameter in parameters] == [
        ("city", True),
        ("country", False),
    ]


def test_get_usage_returns_empty_usage_when_tool_has_no_usage(runtime: DifyToolNodeRuntime) -> None:
    usage = runtime.get_usage(tool_runtime=ToolRuntimeHandle(raw=SimpleNamespace(latest_usage=None)))

    assert usage == LLMUsage.empty_usage()


@pytest.mark.parametrize(
    ("payload", "expected_type"),
    [
        (ToolInvokeMessage.JsonMessage(json_object={"ok": True}, suppress_output=True), ToolRuntimeMessage.JsonMessage),
        (ToolInvokeMessage.BlobMessage(blob=b"bytes"), ToolRuntimeMessage.BlobMessage),
        (
            ToolInvokeMessage.BlobChunkMessage(
                id="blob-id",
                sequence=1,
                total_length=5,
                blob=b"hello",
                end=True,
            ),
            ToolRuntimeMessage.BlobChunkMessage,
        ),
        (ToolInvokeMessage.FileMessage(file_marker="marker"), ToolRuntimeMessage.FileMessage),
        (
            ToolInvokeMessage.VariableMessage(variable_name="city", variable_value="Tokyo", stream=True),
            ToolRuntimeMessage.VariableMessage,
        ),
        (
            ToolInvokeMessage.LogMessage(
                id="log-id",
                label="lookup",
                status=ToolInvokeMessage.LogMessage.LogStatus.SUCCESS,
                data={"count": 1},
                metadata={"source": "tool"},
            ),
            ToolRuntimeMessage.LogMessage,
        ),
    ],
)
def test_convert_message_payload_supports_runtime_message_types(
    runtime: DifyToolNodeRuntime,
    payload: object,
    expected_type: type[object],
) -> None:
    message = runtime._convert_message_payload(payload)

    assert isinstance(message, expected_type)


def test_convert_message_payload_rejects_unknown_types(runtime: DifyToolNodeRuntime) -> None:
    with pytest.raises(TypeError, match="unsupported tool message payload"):
        runtime._convert_message_payload(object())


def test_resolve_provider_icons_prefers_builtin_tool_icons(runtime: DifyToolNodeRuntime) -> None:
    plugin = SimpleNamespace(
        plugin_id="langgenius/tools",
        name="search",
        declaration=SimpleNamespace(icon={"plugin": "icon"}),
    )
    builtin_tool = SimpleNamespace(
        name="langgenius/tools/search",
        icon={"builtin": "icon"},
        icon_dark={"builtin": "dark"},
    )

    with (
        patch("core.workflow.node_runtime.PluginInstaller") as installer_cls,
        patch("core.workflow.node_runtime.BuiltinToolManageService.list_builtin_tools", return_value=[builtin_tool]),
    ):
        installer_cls.return_value.list_plugins.return_value = [plugin]

        icon, icon_dark = runtime.resolve_provider_icons(provider_name="langgenius/tools/search")

    assert icon == {"builtin": "icon"}
    assert icon_dark == {"builtin": "dark"}


def test_resolve_provider_icons_returns_default_when_provider_is_unknown(runtime: DifyToolNodeRuntime) -> None:
    with (
        patch("core.workflow.node_runtime.PluginInstaller") as installer_cls,
        patch("core.workflow.node_runtime.BuiltinToolManageService.list_builtin_tools", return_value=[]),
    ):
        installer_cls.return_value.list_plugins.return_value = []

        icon, icon_dark = runtime.resolve_provider_icons(provider_name="unknown", default_icon="fallback")

    assert icon == "fallback"
    assert icon_dark is None


@pytest.mark.parametrize(
    ("exc", "message"),
    [
        (PluginDaemonClientSideError("bad request"), "Failed to invoke tool, error: bad request"),
        (ToolInvokeError("broken"), "Failed to invoke tool provider: broken"),
        (RuntimeError("unexpected"), "unexpected"),
    ],
)
def test_map_invocation_exception_normalizes_runtime_errors(
    runtime: DifyToolNodeRuntime,
    exc: Exception,
    message: str,
) -> None:
    error = runtime._map_invocation_exception(exc, provider_name="provider")

    assert isinstance(error, ToolRuntimeInvocationError)
    assert str(error) == message
