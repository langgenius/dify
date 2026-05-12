from agenton.compositor import CompositorSessionSnapshot

from clients.agent_backend import (
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunPausedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
)
from core.workflow.nodes.agent_v2.output_adapter import WorkflowAgentOutputAdapter
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.file import FileTransferMethod, FileType
from graphon.variables.segments import ArrayFileSegment, FileSegment


def test_success_output_adapter_preserves_dict_output():
    result = WorkflowAgentOutputAdapter().build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={"summary": "ok"},
            session_snapshot=CompositorSessionSnapshot(layers=[]),
        ),
        inputs={},
        process_data={},
        metadata={"agent_backend": {"run_id": "run-1"}},
    )

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {"summary": "ok"}
    assert result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]["agent_backend"]["status"] == "succeeded"
    assert result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]["agent_backend"]["session_snapshot"] == {
        "layer_count": 0,
    }


def test_failure_output_adapter_maps_paused_to_unsupported_failure():
    result = WorkflowAgentOutputAdapter().build_failure_result(
        event=AgentBackendRunPausedInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            reason="human",
            message=None,
            session_snapshot=None,
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "agent_backend_paused_unsupported"


def test_failure_output_adapter_preserves_backend_failed_reason():
    result = WorkflowAgentOutputAdapter().build_failure_result(
        event=AgentBackendRunFailedInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            error="bad request",
            reason="validation",
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "bad request"
    assert result.error_type == "validation"


def test_success_output_adapter_normalizes_string_and_scalar_outputs():
    adapter = WorkflowAgentOutputAdapter()
    string_result = adapter.build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output="hello",
            session_snapshot=CompositorSessionSnapshot(layers=[]),
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
            session_snapshot=CompositorSessionSnapshot(layers=[]),
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert string_result.outputs == {"text": "hello"}
    assert scalar_result.outputs == {"result": 3}


def test_success_output_adapter_normalizes_file_output_to_file_segments():
    result = WorkflowAgentOutputAdapter().build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={
                "report": {
                    "file_id": "upload-file-1",
                    "filename": "report.pdf",
                    "mime_type": "application/pdf",
                    "size": 12,
                },
                "attachments": [
                    {
                        "tool_file_id": "tool-file-1",
                        "filename": "chart.png",
                        "mime_type": "image/png",
                    }
                ],
            },
            session_snapshot=CompositorSessionSnapshot(layers=[]),
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    report = result.outputs["report"]
    assert isinstance(report, FileSegment)
    assert report.value.type == FileType.DOCUMENT
    assert report.value.transfer_method == FileTransferMethod.LOCAL_FILE
    assert report.value.reference == "upload-file-1"

    attachments = result.outputs["attachments"]
    assert isinstance(attachments, ArrayFileSegment)
    assert attachments.value[0].type == FileType.IMAGE
    assert attachments.value[0].transfer_method == FileTransferMethod.TOOL_FILE
    assert attachments.value[0].reference == "tool-file-1"


def test_success_output_adapter_maps_backend_usage_to_llm_usage_and_metadata():
    result = WorkflowAgentOutputAdapter().build_success_result(
        event=AgentBackendRunSucceededInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            output={"summary": "ok"},
            session_snapshot=CompositorSessionSnapshot(layers=[]),
        ),
        inputs={},
        process_data={},
        metadata={
            "agent_backend": {
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                }
            }
        },
    )

    assert result.llm_usage.prompt_tokens == 10
    assert result.llm_usage.completion_tokens == 5
    assert result.llm_usage.total_tokens == 15
    assert result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 15


def test_failure_output_adapter_maps_cancelled_to_failure_code():
    result = WorkflowAgentOutputAdapter().build_failure_result(
        event=AgentBackendRunCancelledInternalEvent(
            run_id="run-1",
            source_event_id="2-0",
            reason="user_cancelled",
            message=None,
        ),
        inputs={},
        process_data={},
        metadata={},
    )

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "agent_backend_run_cancelled"


def test_stream_exhausted_result_is_failed_with_stream_error():
    result = WorkflowAgentOutputAdapter().build_stream_exhausted_result(
        inputs={},
        process_data={},
        metadata={"agent_backend": {"run_id": "run-1"}},
    )

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "agent_backend_stream_error"
    assert result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]["agent_backend"]["run_id"] == "run-1"
