from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.plugin.impl.exc import PluginInvokeError
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.entities.tool_entities import ToolProviderType as CoreToolProviderType
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.node_runtime import DifyToolNodeRuntime
from dify_graph.model_runtime.entities.llm_entities import LLMUsage
from dify_graph.nodes.tool.entities import ToolNodeData, ToolProviderType
from dify_graph.nodes.tool.exc import ToolRuntimeInvocationError
from dify_graph.nodes.tool_runtime_entities import ToolRuntimeHandle, ToolRuntimeMessage
from tests.workflow_test_utils import build_test_graph_init_params


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


def test_invoke_creates_callback_and_converts_messages(runtime: DifyToolNodeRuntime) -> None:
    core_message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.LINK,
        message=ToolInvokeMessage.TextMessage(text="https://dify.ai"),
        meta=None,
    )

    with (
        patch.object(ToolEngine, "generic_invoke", return_value=iter([core_message])) as generic_invoke_mock,
        patch.object(
            ToolFileMessageTransformer,
            "transform_tool_invoke_messages",
            side_effect=lambda *, messages, **_: messages,
        ),
    ):
        messages = list(
            runtime.invoke(
                tool_runtime=ToolRuntimeHandle(raw=MagicMock()),
                tool_parameters={},
                workflow_call_depth=0,
                conversation_id=None,
                provider_name="provider",
            )
        )

    assert len(messages) == 1
    graph_message = messages[0]
    assert graph_message.type == ToolRuntimeMessage.MessageType.LINK
    assert isinstance(graph_message.message, ToolRuntimeMessage.TextMessage)
    assert graph_message.message.text == "https://dify.ai"

    callback = generic_invoke_mock.call_args.kwargs["workflow_tool_callback"]
    assert isinstance(callback, DifyWorkflowCallbackHandler)


def test_invoke_maps_plugin_errors_to_graph_errors(runtime: DifyToolNodeRuntime) -> None:
    invoke_error = PluginInvokeError('{"error_type":"RateLimit","message":"too many"}')

    with patch.object(ToolEngine, "generic_invoke", side_effect=invoke_error):
        with pytest.raises(ToolRuntimeInvocationError, match="An error occurred in the provider"):
            runtime.invoke(
                tool_runtime=ToolRuntimeHandle(raw=MagicMock()),
                tool_parameters={},
                workflow_call_depth=0,
                conversation_id=None,
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
    node_data = ToolNodeData.model_validate(
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

    with patch.object(ToolManager, "get_workflow_tool_runtime", return_value=MagicMock()) as runtime_mock:
        runtime.get_runtime(node_id="node-id", node_data=node_data, variable_pool=None)

    workflow_tool = runtime_mock.call_args.args[3]
    assert workflow_tool.provider_type == CoreToolProviderType.BUILT_IN
