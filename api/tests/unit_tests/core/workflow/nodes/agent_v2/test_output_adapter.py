import json
from decimal import Decimal
from typing import cast
from unittest.mock import patch

import pytest
from dify_agent.protocol import RunFailureType
from dify_agent.protocol.snapshot import SessionSnapshot

from clients.agent_backend import (
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamInternalEvent,
)
from configs import dify_config
from core.workflow.file_reference import build_file_reference
from core.workflow.nodes.agent_v2.output_adapter import (
    WorkflowAgentOutputAdapter,
    WorkflowAgentProcessProjection,
)
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.variables.segments import ArrayFileSegment, FileSegment
from models.agent_config_entities import DeclaredArrayItem, DeclaredOutputConfig, DeclaredOutputType


def _restored_file(*, transfer_method: FileTransferMethod, reference: str) -> File:
    return File(
        type=FileType.DOCUMENT,
        transfer_method=transfer_method,
        remote_url=None,
        reference=reference,
        filename="report.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=12,
    )


def _rebacked_tool_file(tool_file_id: str) -> File:
    return File(
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.TOOL_FILE,
        remote_url=None,
        related_id=tool_file_id,
        filename="authoritative.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=99,
    )


def _succeeded(output: object) -> AgentBackendRunSucceededInternalEvent:
    return AgentBackendRunSucceededInternalEvent(
        run_id="run-1",
        source_event_id="2-0",
        output=output,
        session_snapshot=SessionSnapshot(layers={}),
    )


def test_minimal_id_file_output_is_rebacked_from_tool_file():
    """Agent Files §4.6: a bare {"id": ...} output is rebacked from the ToolFile row."""
    calls: list[tuple[str, str]] = []

    def rebacker(*, tenant_id: str, tool_file_id: str) -> File | None:
        calls.append((tenant_id, tool_file_id))
        return _rebacked_tool_file(tool_file_id) if tool_file_id == "tool-file-1" else None

    adapter = WorkflowAgentOutputAdapter(tool_file_rebacker=rebacker)
    result = adapter.build_success_result(
        event=_succeeded({"report": {"id": "tool-file-1"}}),
        inputs={},
        process_data={},
        metadata={},
        tenant_id="tenant-1",
    )

    report = result.outputs["report"]
    assert isinstance(report, FileSegment)
    assert report.value.reference == "tool-file-1"
    # metadata comes from the reback, not the sandbox payload
    assert report.value.filename == "authoritative.pdf"
    assert calls == [("tenant-1", "tool-file-1")]


def test_unresolved_minimal_id_stays_a_plain_object():
    adapter = WorkflowAgentOutputAdapter(tool_file_rebacker=lambda **_: None)
    result = adapter.build_success_result(
        event=_succeeded({"thing": {"id": "not-a-file"}}),
        inputs={},
        process_data={},
        metadata={},
        tenant_id="tenant-1",
    )
    assert result.outputs["thing"] == {"id": "not-a-file"}


def test_invalid_minimal_id_stays_a_plain_object_without_reback():
    adapter = WorkflowAgentOutputAdapter(tool_file_rebacker=lambda **_: _rebacked_tool_file("unexpected"))
    result = adapter.build_success_result(
        event=_succeeded({"thing": {"id": 123}}),
        inputs={},
        process_data={},
        metadata={},
        tenant_id="tenant-1",
    )
    assert result.outputs["thing"] == {"id": 123}


def test_success_output_adapter_preserves_existing_file_segment():
    file = _rebacked_tool_file("tool-file-1")
    segment = FileSegment(value=file)
    assert WorkflowAgentOutputAdapter()._normalize_output_value(segment) is segment


def test_array_of_minimal_id_file_outputs_rebacked():
    adapter = WorkflowAgentOutputAdapter(
        tool_file_rebacker=lambda *, tenant_id, tool_file_id: _rebacked_tool_file(tool_file_id)
    )
    result = adapter.build_success_result(
        event=_succeeded({"files": [{"id": "tool-file-1"}, {"id": "tool-file-2"}]}),
        inputs={},
        process_data={},
        metadata={},
        tenant_id="tenant-1",
    )
    files = result.outputs["files"]
    assert isinstance(files, ArrayFileSegment)
    assert [f.reference for f in files.value] == ["tool-file-1", "tool-file-2"]


def test_success_output_adapter_preserves_dict_output():
    result = WorkflowAgentOutputAdapter().build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={"summary": "ok"},
            session_snapshot=SessionSnapshot(layers={}),
        ),
        inputs={},
        process_data={},
        metadata={"agent_backend": {"run_id": "run-1"}},
    )

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {"summary": "ok"}
    assert result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG] == []


def test_terminal_metadata_records_the_terminal_event_and_run_statistics():
    metadata = WorkflowAgentOutputAdapter._with_terminal_metadata(
        {"agent_backend": {"run_id": "run-1"}},
        AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={},
            session_snapshot=SessionSnapshot(layers={}),
        ),
        "succeeded",
    )

    assert metadata["agent_backend"]["run_id"] == "run-1"
    assert metadata["agent_backend"]["status"] == "succeeded"
    assert metadata["agent_backend"]["terminal_event_id"] == "2-0"
    assert metadata["agent_backend"]["session_snapshot"] == {"layer_count": 0}
    assert metadata["terminal_event_type"] == "run_succeeded"


def test_node_metadata_keeps_only_official_keys():
    """``NodeRunResult.metadata`` rejects anything outside the execution metadata enum."""
    metadata = WorkflowAgentOutputAdapter.build_node_execution_metadata(
        metadata={
            "agent_backend": {"run_id": "run-1"},
            "attempt": 0,
            "terminal_event_type": "run_succeeded",
            "total_tokens": 7,
        },
        agent_log=[],
    )

    assert set(metadata) == {
        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS,
        WorkflowNodeExecutionMetadataKey.AGENT_LOG,
    }
    assert metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG] == []


def test_failure_output_adapter_preserves_backend_failed_reason():
    result = WorkflowAgentOutputAdapter().build_failure_result(
        event=AgentBackendRunFailedInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            error="bad request",
            reason="validation",
            session_snapshot=SessionSnapshot(layers={}),
            usage={
                "prompt_tokens": 13,
                "completion_tokens": 8,
                "total_tokens": 21,
                "total_price": "0.000210",
                "currency": "USD",
            },
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "bad request"
    assert result.error_type == "validation"
    assert result.llm_usage.total_tokens == 21
    assert result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 21
    assert result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] == Decimal("0.000210")
    assert result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG] == []


def test_failure_output_adapter_prefers_run_failure_type_over_reason():
    result = WorkflowAgentOutputAdapter().build_failure_result(
        event=AgentBackendRunFailedInternalEvent(
            run_id="run-1",
            error="run limit reached",
            error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
            reason="runtime",
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert result.error_type == "agent_run_limit_exceeded"


def test_failure_output_adapter_uses_default_error_type_without_backend_classification():
    result = WorkflowAgentOutputAdapter().build_failure_result(
        event=AgentBackendRunFailedInternalEvent(
            run_id="run-1",
            error="backend failed",
            error_type=None,
            reason=None,
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert result.error_type == "agent_backend_run_failed"


def test_success_output_adapter_normalizes_string_and_scalar_outputs():
    adapter = WorkflowAgentOutputAdapter()
    string_result = adapter.build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output="hello",
            session_snapshot=SessionSnapshot(layers={}),
        ),
        inputs={},
        process_data={},
        metadata={},
    )
    scalar_result = adapter.build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-2",
            source_event_id="2-0",
            output=3,
            session_snapshot=SessionSnapshot(layers={}),
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert string_result.outputs == {"text": "hello"}
    assert scalar_result.outputs == {"result": 3}


def test_success_output_adapter_normalizes_file_output_to_file_segments():
    upload_reference = build_file_reference(record_id="upload-file-1")
    tool_reference = build_file_reference(record_id="tool-file-1")
    with patch(
        "core.workflow.nodes.agent_v2.output_adapter.build_from_mapping",
        side_effect=[
            _restored_file(transfer_method=FileTransferMethod.LOCAL_FILE, reference=upload_reference),
            _restored_file(transfer_method=FileTransferMethod.TOOL_FILE, reference=tool_reference),
        ],
    ):
        result = WorkflowAgentOutputAdapter().build_success_result(
            event=AgentBackendRunSucceededInternalEvent(
                run_id="run-1",
                source_event_id="2-0",
                output={
                    "report": {
                        "transfer_method": "local_file",
                        "reference": upload_reference,
                    },
                    "attachments": [
                        {
                            "transfer_method": "tool_file",
                            "reference": tool_reference,
                        }
                    ],
                },
                session_snapshot=SessionSnapshot(layers={}),
            ),
            inputs={},
            process_data={},
            metadata={"tenant_id": "tenant-1"},
            declared_outputs=[
                DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE),
                DeclaredOutputConfig(
                    name="attachments",
                    type=DeclaredOutputType.ARRAY,
                    array_item=DeclaredArrayItem(type=DeclaredOutputType.FILE),
                ),
            ],
        )

    report = result.outputs["report"]
    assert isinstance(report, FileSegment)
    assert report.value.transfer_method == FileTransferMethod.LOCAL_FILE
    assert report.value.reference == upload_reference

    attachments = result.outputs["attachments"]
    assert isinstance(attachments, ArrayFileSegment)
    assert attachments.value[0].transfer_method == FileTransferMethod.TOOL_FILE
    assert attachments.value[0].reference == tool_reference


@pytest.mark.parametrize(
    ("payload", "expected_error"),
    [
        ({}, "file mapping missing transfer_method"),
        (
            {"transfer_method": "remote_url", "url": "https://example.com/report.pdf", "extra": "nope"},
            "remote_url file mapping must contain exactly",
        ),
        ({"transfer_method": "remote_url", "url": ""}, "remote_url file mapping missing url"),
        ({"transfer_method": "tool_file", "reference": ""}, "tool_file file mapping missing reference"),
        (
            {"transfer_method": "tool_file", "reference": "raw-tool-file-id"},
            "tool_file file mapping has invalid canonical reference",
        ),
    ],
)
def test_success_output_adapter_rejects_invalid_declared_file_mappings(
    payload: dict[str, object],
    expected_error: str,
) -> None:
    with pytest.raises(ValueError, match=expected_error):
        WorkflowAgentOutputAdapter().build_success_result(
            event=_succeeded({"report": payload}),
            inputs={},
            process_data={},
            metadata={"tenant_id": "tenant-1"},
            declared_outputs=[DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)],
        )


def test_success_output_adapter_requires_tenant_for_canonical_file_mapping():
    reference = build_file_reference(record_id="tool-file-1")
    with pytest.raises(ValueError, match="tenant_id is required"):
        WorkflowAgentOutputAdapter().build_success_result(
            event=_succeeded({"report": {"transfer_method": "tool_file", "reference": reference}}),
            inputs={},
            process_data={},
            metadata={},
            declared_outputs=[DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)],
        )


def test_success_output_adapter_accepts_canonical_file_mapping_for_declared_file_output():
    tool_reference = build_file_reference(record_id="tool-file-1")
    with patch(
        "core.workflow.nodes.agent_v2.output_adapter.build_from_mapping",
        return_value=_restored_file(transfer_method=FileTransferMethod.TOOL_FILE, reference=tool_reference),
    ):
        result = WorkflowAgentOutputAdapter().build_success_result(
            event=AgentBackendRunSucceededInternalEvent(
                run_id="run-1",
                source_event_id="2-0",
                output={"report": {"transfer_method": "tool_file", "reference": tool_reference}},
                session_snapshot=SessionSnapshot(layers={}),
            ),
            inputs={},
            process_data={},
            metadata={"tenant_id": "tenant-1"},
            declared_outputs=[DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)],
        )

    report = result.outputs["report"]
    assert isinstance(report, FileSegment)
    assert report.value.transfer_method == FileTransferMethod.TOOL_FILE
    assert report.value.reference == tool_reference


def test_success_output_adapter_accepts_canonical_datasource_file_mapping_for_declared_file_output():
    datasource_reference = build_file_reference(record_id="datasource-file-1")
    with patch(
        "core.workflow.nodes.agent_v2.output_adapter.build_from_mapping",
        return_value=_restored_file(
            transfer_method=FileTransferMethod.DATASOURCE_FILE,
            reference=datasource_reference,
        ),
    ):
        result = WorkflowAgentOutputAdapter().build_success_result(
            event=AgentBackendRunSucceededInternalEvent(
                run_id="run-1",
                source_event_id="2-0",
                output={"report": {"transfer_method": "datasource_file", "reference": datasource_reference}},
                session_snapshot=SessionSnapshot(layers={}),
            ),
            inputs={},
            process_data={},
            metadata={"tenant_id": "tenant-1"},
            declared_outputs=[DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)],
        )

    report = result.outputs["report"]
    assert isinstance(report, FileSegment)
    assert report.value.transfer_method == FileTransferMethod.DATASOURCE_FILE
    assert report.value.reference == datasource_reference


def test_success_output_adapter_accepts_canonical_remote_url_mapping_for_declared_file_output():
    remote_url = "https://example.com/report.pdf"

    result = WorkflowAgentOutputAdapter().build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={"report": {"transfer_method": "remote_url", "url": remote_url}},
            session_snapshot=SessionSnapshot(layers={}),
        ),
        inputs={},
        process_data={},
        metadata={"tenant_id": "tenant-1"},
        declared_outputs=[DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE)],
    )

    report = result.outputs["report"]
    assert isinstance(report, FileSegment)
    assert report.value.transfer_method == FileTransferMethod.REMOTE_URL
    assert report.value.remote_url == remote_url


def test_success_output_adapter_accepts_canonical_file_mapping_for_declared_array_file_output():
    tool_reference = build_file_reference(record_id="tool-file-1")
    with patch(
        "core.workflow.nodes.agent_v2.output_adapter.build_from_mapping",
        return_value=_restored_file(transfer_method=FileTransferMethod.TOOL_FILE, reference=tool_reference),
    ):
        result = WorkflowAgentOutputAdapter().build_success_result(
            event=AgentBackendRunSucceededInternalEvent(
                run_id="run-1",
                source_event_id="2-0",
                output={"attachments": [{"transfer_method": "tool_file", "reference": tool_reference}]},
                session_snapshot=SessionSnapshot(layers={}),
            ),
            inputs={},
            process_data={},
            metadata={"tenant_id": "tenant-1"},
            declared_outputs=[
                DeclaredOutputConfig(
                    name="attachments",
                    type=DeclaredOutputType.ARRAY,
                    array_item=DeclaredArrayItem(type=DeclaredOutputType.FILE),
                )
            ],
        )

    attachments = result.outputs["attachments"]
    assert isinstance(attachments, ArrayFileSegment)
    assert attachments.value[0].transfer_method == FileTransferMethod.TOOL_FILE
    assert attachments.value[0].reference == tool_reference


def test_success_output_adapter_does_not_treat_generic_object_with_string_id_as_file():
    result = WorkflowAgentOutputAdapter().build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={"meta": {"id": "123", "type": "summary"}},
            session_snapshot=SessionSnapshot(layers={}),
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert result.outputs["meta"] == {"id": "123", "type": "summary"}


def test_success_output_adapter_does_not_crash_on_generic_object_with_non_string_id():
    result = WorkflowAgentOutputAdapter().build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={"meta": {"id": 1, "name": "foo"}},
            session_snapshot=SessionSnapshot(layers={}),
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert result.outputs["meta"] == {"id": 1, "name": "foo"}


def test_success_output_adapter_preserves_nested_canonical_file_mapping_inside_object_output():
    tool_reference = build_file_reference(record_id="tool-file-1")
    result = WorkflowAgentOutputAdapter().build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={
                "meta": {
                    "attachment": {
                        "transfer_method": "tool_file",
                        "reference": tool_reference,
                    }
                }
            },
            session_snapshot=SessionSnapshot(layers={}),
        ),
        inputs={},
        process_data={},
        metadata={},
        declared_outputs=[DeclaredOutputConfig(name="meta", type=DeclaredOutputType.OBJECT)],
    )

    assert result.outputs["meta"] == {
        "attachment": {
            "transfer_method": "tool_file",
            "reference": tool_reference,
        }
    }


def test_success_output_adapter_preserves_nested_canonical_file_mapping_inside_generic_array_output():
    tool_reference = build_file_reference(record_id="tool-file-1")
    result = WorkflowAgentOutputAdapter().build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={
                "items": [
                    {
                        "attachment": {
                            "transfer_method": "tool_file",
                            "reference": tool_reference,
                        }
                    }
                ]
            },
            session_snapshot=SessionSnapshot(layers={}),
        ),
        inputs={},
        process_data={},
        metadata={},
        declared_outputs=[
            DeclaredOutputConfig(
                name="items",
                type=DeclaredOutputType.ARRAY,
                array_item=DeclaredArrayItem(type=DeclaredOutputType.OBJECT),
            )
        ],
    )

    assert result.outputs["items"] == [
        {
            "attachment": {
                "transfer_method": "tool_file",
                "reference": tool_reference,
            }
        }
    ]


def test_success_output_adapter_maps_backend_usage_to_llm_usage_and_metadata():
    result = WorkflowAgentOutputAdapter().build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={"summary": "ok"},
            session_snapshot=SessionSnapshot(layers={}),
            usage={
                "prompt_tokens": 10,
                "prompt_unit_price": "5",
                "prompt_price_unit": "0.000001",
                "prompt_price": "0.000050",
                "completion_tokens": 5,
                "completion_unit_price": "30",
                "completion_price_unit": "0.000001",
                "completion_price": "0.000150",
                "total_tokens": 15,
                "total_price": "0.000200",
                "currency": "USD",
                "latency": 0.5,
            },
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert result.llm_usage.prompt_tokens == 10
    assert result.llm_usage.completion_tokens == 5
    assert result.llm_usage.total_tokens == 15
    assert result.llm_usage.prompt_price == Decimal("0.000050")
    assert result.llm_usage.completion_price == Decimal("0.000150")
    assert result.llm_usage.total_price == Decimal("0.000200")
    assert result.llm_usage.currency == "USD"
    assert result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 15
    assert result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] == Decimal("0.000200")
    assert result.metadata[WorkflowNodeExecutionMetadataKey.CURRENCY] == "USD"


def test_failure_output_adapter_maps_cancelled_to_failure_code():
    result = WorkflowAgentOutputAdapter().build_failure_result(
        event=AgentBackendRunCancelledInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            reason="user_cancelled",
            message=None,
            usage={"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "agent_backend_run_cancelled"
    assert result.llm_usage.total_tokens == 8
    assert result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 8


def test_stream_exhausted_result_is_failed_with_stream_error():
    result = WorkflowAgentOutputAdapter().build_stream_exhausted_result(
        inputs={},
        process_data={},
        metadata={"agent_backend": {"run_id": "run-1"}},
    )

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "agent_backend_stream_error"
    assert result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG] == []


# ── Agent process projection and execution metadata flatting ──────────────


def _projection() -> WorkflowAgentProcessProjection:
    return WorkflowAgentProcessProjection(node_id="agent-node", node_execution_id="exec-1")


def _stream_event(event_kind: str, **data: object) -> AgentBackendStreamInternalEvent:
    return AgentBackendStreamInternalEvent(
        run_id="run-1",
        source_event_id="evt-1",
        event_kind=event_kind,
        data=cast(dict[str, object], data),
    )


def test_projection_records_thinking_segment():
    projection = _projection()
    projection.observe(_stream_event(
        "part_start",
        index=0,
        part={"part_kind": "thinking", "content": "Let me start"},
    ))
    projection.observe(_stream_event(
        "part_delta",
        index=0,
        delta={"part_delta_kind": "thinking", "content_delta": " with the skill"},
    ))

    entries = projection.entries()

    assert len(entries) == 1
    assert entries[0].label == "Thinking"
    assert entries[0].data["thought"] == "Let me start with the skill"
    assert entries[0].node_execution_id == "exec-1"
    assert entries[0].node_id == "agent-node"


def test_projection_starts_a_new_thinking_entry_after_a_tool_call():
    projection = _projection()
    projection.observe(_stream_event(
        "part_delta",
        index=0,
        delta={"part_delta_kind": "thinking", "content_delta": "before tool"},
    ))
    projection.observe(_stream_event(
        "function_tool_call",
        index=1,
        part={"part_kind": "tool-call", "tool_name": "shell_run", "tool_call_id": "tc-1", "args": {"cmd": "ls"}},
    ))
    projection.observe(_stream_event(
        "part_delta",
        index=0,
        delta={"part_delta_kind": "thinking", "content_delta": "after tool"},
    ))

    entries = projection.entries()

    assert len(entries) == 3
    assert entries[0].data["thought"] == "before tool"
    assert entries[1].label == "shell_run"
    assert entries[1].data["tool_input"] == '{"cmd": "ls"}'
    assert entries[2].data["thought"] == "after tool"


def test_projection_merges_tool_call_and_result_by_tool_call_id():
    projection = _projection()
    projection.observe(_stream_event(
        "part_delta",
        index=0,
        delta={"part_delta_kind": "tool_call", "tool_call_id": "tc-1", "tool_name": "shell_run"},
    ))
    projection.observe(_stream_event(
        "function_tool_call",
        index=0,
        part={"tool_name": "shell_run", "tool_call_id": "tc-1", "args": {"cmd": "pwd"}},
    ))
    projection.observe(_stream_event(
        "function_tool_result",
        index=0,
        part={"tool_name": "shell_run", "tool_call_id": "tc-1", "content": {"output": "/app"}},
    ))

    entries = projection.entries()

    assert len(entries) == 1
    assert entries[0].data["observation"] == '{"output": "/app"}'
    assert entries[0].data["tool_input"] == '{"cmd": "pwd"}'


def test_projection_falls_back_to_index_when_tool_call_id_is_missing():
    projection = _projection()
    projection.observe(_stream_event(
        "part_start",
        index=2,
        part={"part_kind": "tool-call", "tool_name": "shell_wait", "args": {"seconds": 1}},
    ))
    projection.observe(_stream_event(
        "function_tool_result",
        index=2,
        part={"tool_name": "shell_wait", "content": "done"},
    ))

    entries = projection.entries()

    assert len(entries) == 1
    assert entries[0].label == "shell_wait"
    assert entries[0].data["observation"] == '"done"'


def test_projection_discards_invalid_partial_tool_input():
    projection = _projection()
    projection.observe(_stream_event(
        "part_delta",
        index=0,
        delta={
            "part_delta_kind": "tool_call",
            "tool_call_id": "tc-1",
            "tool_name": "shell_run",
            "args_delta": '{"cmd": "ech',
        },
    ))

    entries = projection.entries()

    assert entries[0].data["tool_input"] is None


def test_projection_records_model_text_as_message_entries():
    projection = _projection()
    projection.observe_agent_message_delta("I will ")
    projection.observe_agent_message_delta("pull the skill")
    projection.observe(_stream_event(
        "function_tool_call",
        index=0,
        part={"tool_name": "shell_run", "tool_call_id": "tc-1", "args": {}},
    ))
    projection.observe_agent_message_delta("Reading it now")

    entries = projection.entries()

    assert [entry.label for entry in entries] == ["Message", "shell_run", "Message"]
    assert entries[0].data["answer"] == "I will pull the skill"
    assert entries[2].data["answer"] == "Reading it now"


def test_projection_truncates_a_single_field_over_the_string_limit(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(dify_config, "WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH", 16, raising=False)
    projection = _projection()
    projection.observe(_stream_event(
        "part_delta",
        index=0,
        delta={"part_delta_kind": "thinking", "content_delta": "x" * 40},
    ))

    entries = projection.entries()

    assert entries[0].data["thought"] == "x" * 16 + "\n…[truncated]"


def test_projection_evicts_oldest_entries_over_the_byte_budget(monkeypatch: pytest.MonkeyPatch):
    # A budget below a single entry forces the notice path deterministically.
    monkeypatch.setattr(dify_config, "WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE", 20, raising=False)
    monkeypatch.setattr(dify_config, "WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH", 100_000, raising=False)
    projection = _projection()
    for index in range(3):
        projection.observe(_stream_event(
            "function_tool_call",
            index=index,
            part={"tool_name": "shell_run", "tool_call_id": f"tc-{index}", "args": {"n": index}},
        ))

    entries = projection.entries()

    assert [entry.label for entry in entries] == ["Agent process truncated"]
    assert entries[0].data == {"truncated": True}
    assert entries[0].node_execution_id == "exec-1"


def test_projection_keeps_newest_entries_when_trimming_to_the_budget(monkeypatch: pytest.MonkeyPatch):
    # A budget between one and two entries keeps the tail and drops the head.
    monkeypatch.setattr(dify_config, "WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE", 74, raising=False)
    monkeypatch.setattr(dify_config, "WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH", 100_000, raising=False)
    projection = _projection()
    for index in range(3):
        projection.observe(_stream_event(
            "function_tool_call",
            index=index,
            part={"tool_name": "shell_run", "tool_call_id": f"tc-{index}", "args": {"n": index}},
        ))

    entries = projection.entries()

    total = sum(
        len(json.dumps(entry.data, ensure_ascii=False)) + len(entry.label) for entry in entries
    )
    assert len(entries) == 2
    assert [entry.label for entry in entries] == ["shell_run", "shell_run"]
    assert entries[0].data["tool_input"] == '{"n": 1}'
    assert entries[1].data["tool_input"] == '{"n": 2}'
    assert total <= 74


def test_projection_announces_the_truncation_when_one_entry_exceeds_the_budget(
    monkeypatch: pytest.MonkeyPatch,
):
    """A single entry too big for the budget is replaced by the notice, not kept."""
    monkeypatch.setattr(dify_config, "WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE", 200, raising=False)
    monkeypatch.setattr(dify_config, "WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH", 500, raising=False)
    projection = _projection()
    projection.observe(_stream_event(
        "part_delta",
        index=0,
        delta={"part_delta_kind": "thinking", "content_delta": "x" * 900},
    ))

    entries = projection.entries()

    assert [entry.label for entry in entries] == ["Agent process truncated"]
    assert entries[0].data == {"truncated": True}


def test_projection_keeps_the_notice_only_when_every_entry_exceeds_the_budget(
    monkeypatch: pytest.MonkeyPatch,
):
    """Both entries being over budget still ends with the notice and no payload."""
    monkeypatch.setattr(dify_config, "WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE", 200, raising=False)
    monkeypatch.setattr(dify_config, "WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH", 500, raising=False)
    projection = _projection()
    for index in range(2):
        projection.observe(_stream_event(
            "function_tool_call",
            index=index,
            part={"tool_name": "shell_run", "tool_call_id": f"tc-{index}", "args": {"n": "x" * 500}},
        ))

    entries = projection.entries()

    assert [entry.label for entry in entries] == ["Agent process truncated"]


def test_projection_skips_output_tool_calls_and_non_mapping_payloads():
    projection = _projection()
    projection.observe(AgentBackendStreamInternalEvent(
        run_id="run-1",
        source_event_id="evt-1",
        event_kind="output_tool_call",
        data=None,
    ))
    projection.observe(_stream_event(
        "part_start",
        index=0,
        part={"part_kind": "output-tool-call", "tool_name": "final_output", "args": {"x": 1}},
    ))
    projection.observe(_stream_event(
        "part_delta",
        index=0,
        delta={"part_delta_kind": "tool_return", "content": "ignored"},
    ))

    assert projection.entries() == []


def test_projection_entries_is_idempotent():
    projection = _projection()
    projection.observe(_stream_event(
        "part_delta",
        index=0,
        delta={"part_delta_kind": "thinking", "content_delta": "once"},
    ))

    first = projection.entries()
    second = projection.entries()

    assert first == second
    assert len(first) == 1


def test_node_execution_metadata_keeps_official_keys_and_the_agent_log_array():
    projection = _projection()
    projection.observe(_stream_event(
        "function_tool_call",
        index=0,
        part={"tool_name": "shell_run", "tool_call_id": "tc-1", "args": {"cmd": "ls"}},
    ))

    metadata = WorkflowAgentOutputAdapter.build_node_execution_metadata(
        metadata={"agent_backend": {"run_id": "run-1"}, "attempt": 0, "total_tokens": 9},
        agent_log=projection.entries(),
    )

    assert set(metadata) == {
        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS,
        WorkflowNodeExecutionMetadataKey.AGENT_LOG,
    }
    assert isinstance(metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG], list)
    assert len(metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]) == 1


def test_node_execution_metadata_defaults_to_an_empty_agent_log():
    metadata = WorkflowAgentOutputAdapter.build_node_execution_metadata(
        metadata={"agent_backend": {"run_id": "run-1"}},
    )

    assert metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG] == []


def test_build_node_metadata_keeps_usage_fields_after_flatting():
    usage = LLMUsage.from_metadata({"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12})

    node_metadata = WorkflowAgentOutputAdapter._build_node_metadata(
        metadata={"agent_backend": {"usage": {"total_tokens": 12}}},
        usage=usage,
    )

    assert node_metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 12
    assert node_metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] == usage.total_price
    assert node_metadata[WorkflowNodeExecutionMetadataKey.CURRENCY] == usage.currency
    assert node_metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG] == []


def test_build_node_metadata_keeps_official_sibling_keys_only():
    node_metadata = WorkflowAgentOutputAdapter._build_node_metadata(
        metadata={
            "agent_backend": {"run_id": "run-1"},
            "attempt": 1,
            "terminal_event_type": "run_failed",
            "total_tokens": 3,
        },
        usage=None,
    )

    assert set(node_metadata) == {
        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS,
        WorkflowNodeExecutionMetadataKey.AGENT_LOG,
    }
    assert node_metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 3
