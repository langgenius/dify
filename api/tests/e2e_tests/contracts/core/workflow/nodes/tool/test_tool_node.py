from __future__ import annotations

from collections.abc import Generator, Iterator, Mapping
from typing import Any
from unittest.mock import MagicMock

import pytest
from pydantic import TypeAdapter, ValidationError
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.app.file_access import DatabaseFileAccessController
from core.workflow.file_reference import resolve_file_record_id
from core.workflow.node_runtime import DifyToolFileManager
from core.workflow.system_variables import build_system_variables
from factories.file_factory import ToolFileMapping, build_from_mapping
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import StreamChunkEvent, StreamCompletedEvent
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool.tool_node import ToolNode
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle, ToolRuntimeMessage
from graphon.runtime import RuntimeState
from graphon.variables.segments import ArrayFileSegment
from models.tools import ToolFile
from tests.workflow_test_utils import build_test_graph_init_params, build_test_variable_pool

# The production boundary shape for tool-produced file mappings, imported rather
# than re-declared here: a change to the factory's accepted keys must reach this
# contract test instead of silently drifting apart from it.
_TOOL_FILE_MAPPING_ADAPTER = TypeAdapter(ToolFileMapping)

# One tenant identity shared by the graph init params and the persisted tool-file
# row, so the factory's tenant filter is exercised instead of bypassed.
_TENANT_ID = "tenant-id"


class _StubToolRuntime:
    """Tool runtime stub: only the capabilities `graphon`'s ToolNode calls.

    Invariant: ``build_file_reference`` returns a ``File``, never the incoming
    mapping, so the stub cannot hide a contract the production runtime honours.
    """

    def __init__(self, *, tenant_id: str) -> None:
        self._tenant_id = tenant_id

    def get_runtime(
        self,
        *,
        node_id: str,
        node_data: Any,
        variable_pool: Any,
        node_execution_id: str | None = None,
    ) -> ToolRuntimeHandle:
        raise NotImplementedError

    def get_runtime_parameters(self, *, tool_runtime: ToolRuntimeHandle) -> list[Any]:
        return []

    def invoke(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
        tool_parameters: Mapping[str, Any],
        workflow_call_depth: int,
        provider_name: str,
    ) -> Generator[ToolRuntimeMessage]:
        yield from ()

    def get_usage(self, *, tool_runtime: ToolRuntimeHandle) -> LLMUsage:
        return LLMUsage.empty_usage()

    def build_file_reference(self, *, mapping: Mapping[str, Any]) -> File:
        """Parse the tool mapping at the boundary, then build the real ``File``.

        Preconditions: ``mapping`` validates against the production
        ``ToolFileMapping`` shape and the referenced ``ToolFile`` row exists for
        ``self._tenant_id``. Postconditions: the result is a ``File`` rebuilt from
        that row, so the node's file output is the production value rather than a
        hand-built stand-in. Failure behavior: a mapping that does not parse
        raises ``ValidationError`` and an unknown record raises ``ValueError``;
        neither path returns the mapping.
        """
        parsed = _TOOL_FILE_MAPPING_ADAPTER.validate_python(mapping)
        return build_from_mapping(
            mapping=parsed,
            tenant_id=self._tenant_id,
            access_controller=DatabaseFileAccessController(),
        )

    def resolve_provider_icons(
        self,
        *,
        provider_name: str,
        default_icon: str | None = None,
    ) -> tuple[str | None, str | None]:
        return default_icon, None


class _StubToolFileStore:
    """In-memory :class:`core.workflow.node_runtime.ToolFileStore` for the contract tests."""

    def __init__(self, tool_files: Mapping[str, File] | None = None) -> None:
        self.tool_files: dict[str, File] = dict(tool_files or {})
        self.requested_ids: list[str] = []

    def create_file_by_raw(
        self,
        *,
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        file_binary: bytes,
        mimetype: str,
        filename: str | None = None,
    ) -> ToolFile:
        raise NotImplementedError

    def get_file_generator_by_tool_file_id(self, tool_file_id: str) -> tuple[Generator[bytes] | None, File | None]:
        self.requested_ids.append(tool_file_id)
        return None, self.tool_files.get(tool_file_id)


def _build_tool_node(
    *, tool_file_store: _StubToolFileStore | None = None, runtime: _StubToolRuntime | None = None
) -> ToolNode:
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
        tenant_id=_TENANT_ID,
        app_id="app-id",
        user_id="user-id",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )

    variable_pool = build_test_variable_pool(variables=build_system_variables(user_id="user-id"))
    graph_runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0.0)

    config = graph_config["nodes"][0]

    tool_file_manager = DifyToolFileManager(
        init_params.run_context,
        tool_file_store=tool_file_store if tool_file_store is not None else _StubToolFileStore(),
    )

    return ToolNode(
        node_id="node-instance",
        data=ToolNodeData.model_validate(config["data"]),
        init_params=init_params,
        runtime_state=graph_runtime_state,
        tool_file_manager=tool_file_manager,
        runtime=runtime if runtime is not None else _StubToolRuntime(tenant_id=_TENANT_ID),
    )


@pytest.fixture
def tool_node() -> ToolNode:
    return _build_tool_node()


def _collect_events(generator: Iterator[Any]) -> list[Any]:
    events: list[Any] = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration:
        return events


def _single_message_stream(message: ToolRuntimeMessage) -> Generator[ToolRuntimeMessage]:
    yield message


def _run_transform(tool_node: ToolNode, message: ToolRuntimeMessage) -> tuple[list[Any], LLMUsage]:
    generator = tool_node._transform_message(
        messages=_single_message_stream(message),
        tool_info={"provider_type": "builtin", "provider_id": "provider"},
        parameters_for_log={},
        node_id=tool_node._node_id,
        tool_runtime=ToolRuntimeHandle(raw=object()),
    )
    events = _collect_events(generator)
    completed_events = [event for event in events if isinstance(event, StreamCompletedEvent)]
    assert completed_events
    return events, completed_events[-1].node_run_result.llm_usage


def test_link_messages_with_file_populate_files_output(tool_node: ToolNode) -> None:
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


def test_plain_link_messages_remain_links(tool_node: ToolNode) -> None:
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


def test_image_link_messages_use_tool_file_id_metadata(sqlite_session: Session) -> None:
    stored_tool_file = ToolFile(
        user_id="user-id",
        tenant_id=_TENANT_ID,
        conversation_id=None,
        file_key="file-key",
        mimetype="application/pdf",
        original_url="http://example.com/demo.pdf",
        name="demo.pdf",
        size=123,
    )
    stored_tool_file.id = "file-id"
    sqlite_session.add(stored_tool_file)
    sqlite_session.commit()

    tool_file = File(
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.TOOL_FILE,
        related_id="file-id",
        filename="demo.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=123,
        storage_key="file-key",
    )
    store = _StubToolFileStore(tool_files={"file-id": tool_file})
    tool_node = _build_tool_node(tool_file_store=store, runtime=_StubToolRuntime(tenant_id=_TENANT_ID))
    message = ToolRuntimeMessage(
        type=ToolRuntimeMessage.MessageType.IMAGE_LINK,
        message=ToolRuntimeMessage.TextMessage(text="/files/tools/file-id.pdf"),
        meta={"tool_file_id": "file-id"},
    )

    events, _ = _run_transform(tool_node, message)

    assert store.requested_ids == ["file-id"]
    completed_events = [event for event in events if isinstance(event, StreamCompletedEvent)]
    assert len(completed_events) == 1
    files_segment = completed_events[0].node_run_result.outputs["files"]
    assert isinstance(files_segment, ArrayFileSegment)
    assert len(files_segment.value) == 1
    built_file = files_segment.value[0]
    assert isinstance(built_file, File)
    # Every field comes from the persisted row through the production factory,
    # so a stub that echoed the mapping back could not satisfy these.
    assert built_file.filename == stored_tool_file.name
    assert built_file.extension == ".pdf"
    assert built_file.mime_type == stored_tool_file.mimetype
    assert built_file.size == stored_tool_file.size
    assert built_file.storage_key == stored_tool_file.file_key
    assert built_file.remote_url == stored_tool_file.original_url
    assert built_file.transfer_method == FileTransferMethod.TOOL_FILE
    assert built_file.type == FileType.DOCUMENT
    assert built_file.reference is not None
    assert resolve_file_record_id(built_file.reference) == stored_tool_file.id


def test_tool_file_from_another_tenant_is_not_reachable(sqlite_session: Session) -> None:
    """A tool-file row owned by another tenant must not resolve.

    Preconditions: the only ``ToolFile`` row with this id belongs to a different
    tenant than the workflow. Postconditions: building the reference fails, so a
    node cannot read another tenant's tool output through a forged id.
    """
    foreign_tool_file = ToolFile(
        user_id="user-id",
        tenant_id="another-tenant",
        conversation_id=None,
        file_key="file-key",
        mimetype="application/pdf",
        original_url="http://example.com/demo.pdf",
        name="demo.pdf",
        size=123,
    )
    foreign_tool_file.id = "file-id"
    sqlite_session.add(foreign_tool_file)
    sqlite_session.commit()

    runtime = _StubToolRuntime(tenant_id=_TENANT_ID)
    with pytest.raises(ValueError, match="not found"):
        runtime.build_file_reference(mapping={"tool_file_id": "file-id", "transfer_method": "tool_file"})


def test_mapping_missing_transfer_method_is_rejected_at_the_boundary() -> None:
    """The mapping is validated as a ``ToolFileMapping`` before any lookup.

    Preconditions: the mapping carries a tool-file id but no ``transfer_method``,
    so it does not describe a tool-produced file. Postconditions: validation
    fails before the factory is reached, which is what makes the parse step load
    bearing rather than decorative.
    """
    runtime = _StubToolRuntime(tenant_id=_TENANT_ID)
    with pytest.raises(ValidationError):
        runtime.build_file_reference(mapping={"tool_file_id": "file-id"})


def test_tool_node_passes_node_execution_id_when_runtime_accepts_it(tool_node: ToolNode, mocker: MockerFixture) -> None:
    runtime_handle = ToolRuntimeHandle(raw=object())
    get_runtime_mock = MagicMock(return_value=runtime_handle)
    mocker.patch.object(tool_node._runtime, "get_runtime", get_runtime_mock)

    result = tool_node._get_tool_runtime(
        variable_pool=tool_node.runtime_state.variable_pool,
        node_execution_id="node-execution-id",
    )

    assert result is runtime_handle
    get_runtime_mock.assert_called_once_with(
        node_id="node-instance",
        node_data=tool_node.node_data,
        variable_pool=tool_node.runtime_state.variable_pool,
        node_execution_id="node-execution-id",
    )
