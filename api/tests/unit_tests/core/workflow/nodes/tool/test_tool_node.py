from __future__ import annotations

import sys
import types
from collections.abc import Generator
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any
from unittest.mock import MagicMock

import pytest

from core.workflow.system_variables import build_system_variables
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import StreamChunkEvent, StreamCompletedEvent
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle, ToolRuntimeMessage
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variables.segments import ArrayFileSegment
from tests.workflow_test_utils import build_test_graph_init_params

if TYPE_CHECKING:  # pragma: no cover - imported for type checking only
    from graphon.nodes.tool.tool_node import ToolNode


class _StubToolRuntime:
    def get_runtime(self, *, node_id: str, node_data: Any, variable_pool: Any) -> ToolRuntimeHandle:
        raise NotImplementedError

    def get_runtime_parameters(self, *, tool_runtime: ToolRuntimeHandle) -> list[Any]:
        return []

    def invoke(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
        tool_parameters: dict[str, Any],
        workflow_call_depth: int,
        provider_name: str,
    ) -> Generator[ToolRuntimeMessage, None, None]:
        yield from ()

    def get_usage(self, *, tool_runtime: ToolRuntimeHandle) -> LLMUsage:
        return LLMUsage.empty_usage()

    def build_file_reference(self, *, mapping: dict[str, Any]) -> Any:
        return mapping

    def resolve_provider_icons(
        self,
        *,
        provider_name: str,
        default_icon: str | None = None,
    ) -> tuple[str | None, str | None]:
        return default_icon, None


@pytest.fixture
def tool_node(monkeypatch) -> ToolNode:
    module_name = "core.ops.ops_trace_manager"
    if module_name not in sys.modules:
        ops_stub = types.ModuleType(module_name)
        ops_stub.TraceQueueManager = object  # pragma: no cover - stub attribute
        ops_stub.TraceTask = object  # pragma: no cover - stub attribute
        monkeypatch.setitem(sys.modules, module_name, ops_stub)

    from graphon.nodes.protocols import ToolFileManagerProtocol
    from graphon.nodes.tool.tool_node import ToolNode

    graph_config: dict[str, Any] = {
        "nodes": [
            {
                "id": "tool-node",
                "data": {
                    "type": "tool",
                    "title": "Tool",
                    "desc": "",
                    "provider_id": "provider",
                    "provider_type": "builtin",
                    "provider_name": "provider",
                    "tool_name": "tool",
                    "tool_label": "tool",
                    "tool_configurations": {},
                    "tool_parameters": {},
                },
            }
        ],
        "edges": [],
    }

    init_params = build_test_graph_init_params(
        workflow_id="workflow-id",
        graph_config=graph_config,
        tenant_id="tenant-id",
        app_id="app-id",
        user_id="user-id",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )

    variable_pool = VariablePool.from_bootstrap(system_variables=build_system_variables(user_id="user-id"))
    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)

    config = graph_config["nodes"][0]

    # Provide a stub ToolFileManager to satisfy the updated ToolNode constructor
    tool_file_manager_factory = MagicMock(spec=ToolFileManagerProtocol)
    runtime = _StubToolRuntime()

    node = ToolNode(
        node_id="node-instance",
        data=ToolNodeData.model_validate(config["data"]),
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        tool_file_manager_factory=tool_file_manager_factory,
        runtime=runtime,
    )
    return node


def _collect_events(generator: Generator) -> list[Any]:
    events: list[Any] = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration:
        return events


def _run_transform(tool_node: ToolNode, message: ToolRuntimeMessage) -> tuple[list[Any], LLMUsage]:
    generator = tool_node._transform_message(
        messages=iter([message]),
        tool_info={"provider_type": "builtin", "provider_id": "provider"},
        parameters_for_log={},
        node_id=tool_node._node_id,
        tool_runtime=ToolRuntimeHandle(raw=object()),
    )
    events = _collect_events(generator)
    completed_events = [event for event in events if isinstance(event, StreamCompletedEvent)]
    assert completed_events
    return events, completed_events[-1].node_run_result.llm_usage


def test_link_messages_with_file_populate_files_output(tool_node: ToolNode):
    file_obj = File(
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.TOOL_FILE,
        related_id="file-id",
        filename="demo.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=123,
        storage_key="file-key",
    )
    message = ToolRuntimeMessage(
        type=ToolRuntimeMessage.MessageType.LINK,
        message=ToolRuntimeMessage.TextMessage(text="/files/tools/file-id.pdf"),
        meta={"file": file_obj},
    )

    events, usage = _run_transform(tool_node, message)

    assert isinstance(usage, LLMUsage)

    chunk_events = [event for event in events if isinstance(event, StreamChunkEvent)]
    assert chunk_events
    assert chunk_events[0].chunk == "File: /files/tools/file-id.pdf\n"

    completed_events = [event for event in events if isinstance(event, StreamCompletedEvent)]
    assert len(completed_events) == 1
    outputs = completed_events[0].node_run_result.outputs
    assert outputs["text"] == "File: /files/tools/file-id.pdf\n"

    files_segment = outputs["files"]
    assert isinstance(files_segment, ArrayFileSegment)
    assert files_segment.value == [file_obj]


def test_plain_link_messages_remain_links(tool_node: ToolNode):
    message = ToolRuntimeMessage(
        type=ToolRuntimeMessage.MessageType.LINK,
        message=ToolRuntimeMessage.TextMessage(text="https://dify.ai"),
        meta=None,
    )

    events, _ = _run_transform(tool_node, message)

    chunk_events = [event for event in events if isinstance(event, StreamChunkEvent)]
    assert chunk_events
    assert chunk_events[0].chunk == "Link: https://dify.ai\n"

    completed_events = [event for event in events if isinstance(event, StreamCompletedEvent)]
    assert len(completed_events) == 1
    files_segment = completed_events[0].node_run_result.outputs["files"]
    assert isinstance(files_segment, ArrayFileSegment)
    assert files_segment.value == []


def test_image_link_messages_use_tool_file_id_metadata(tool_node: ToolNode):
    file_obj = File(
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.TOOL_FILE,
        related_id="file-id",
        filename="demo.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=123,
        storage_key="file-key",
    )
    tool_node._tool_file_manager_factory.get_file_generator_by_tool_file_id.return_value = (
        None,
        SimpleNamespace(mime_type="application/pdf"),
    )
    tool_node._runtime.build_file_reference = MagicMock(return_value=file_obj)
    message = ToolRuntimeMessage(
        type=ToolRuntimeMessage.MessageType.IMAGE_LINK,
        message=ToolRuntimeMessage.TextMessage(text="/files/tools/file-id.pdf"),
        meta={"tool_file_id": "file-id"},
    )

    events, _ = _run_transform(tool_node, message)

    tool_node._tool_file_manager_factory.get_file_generator_by_tool_file_id.assert_called_once_with("file-id")
    completed_events = [event for event in events if isinstance(event, StreamCompletedEvent)]
    assert len(completed_events) == 1
    files_segment = completed_events[0].node_run_result.outputs["files"]
    assert isinstance(files_segment, ArrayFileSegment)
    assert files_segment.value == [file_obj]
