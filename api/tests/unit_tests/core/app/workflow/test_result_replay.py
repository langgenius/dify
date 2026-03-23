import json
from datetime import datetime

from core.app.workflow.result_replay import WorkflowResultReplayBuilder, build_result_replay_from_node_executions
from core.file import FILE_MODEL_IDENTITY
from core.workflow.entities import ToolCall, ToolResult, ToolResultStatus, WorkflowNodeExecution
from core.workflow.enums import NodeType, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.graph_events import ChunkType, NodeRunStreamChunkEvent


def _stream_event(
    *,
    chunk_type: ChunkType,
    chunk: str = "",
    tool_call: ToolCall | None = None,
    tool_result: ToolResult | None = None,
) -> NodeRunStreamChunkEvent:
    return NodeRunStreamChunkEvent(
        id="execution-1",
        node_id="answer-node",
        node_type=NodeType.ANSWER,
        selector=["answer-node", "answer"],
        chunk=chunk,
        is_final=False,
        chunk_type=chunk_type,
        tool_call=tool_call,
        tool_result=tool_result,
    )


def test_workflow_result_replay_builder_preserves_generation_sequence_and_files() -> None:
    builder = WorkflowResultReplayBuilder()
    file_payload = {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "related_id": "file-1",
        "filename": "report.pdf",
        "size": 128,
        "mime_type": "application/pdf",
        "transfer_method": "local_file",
        "type": "document",
        "url": "https://example.com/report.pdf",
        "upload_file_id": "upload-file-1",
        "remote_url": "",
    }

    builder.add_stream_chunk(_stream_event(chunk_type=ChunkType.THOUGHT_START))
    builder.add_stream_chunk(_stream_event(chunk_type=ChunkType.THOUGHT, chunk="Need to inspect the workspace."))
    builder.add_stream_chunk(_stream_event(chunk_type=ChunkType.THOUGHT_END))
    builder.add_stream_chunk(_stream_event(chunk_type=ChunkType.TEXT, chunk="I checked the directory.\n"))
    builder.add_stream_chunk(
        _stream_event(
            chunk_type=ChunkType.TOOL_CALL,
            tool_call=ToolCall(
                id="tool-call-1",
                name="bash",
                arguments=json.dumps({"command": "ls"}),
                icon="light-icon",
                icon_dark="dark-icon",
            ),
        )
    )
    builder.add_stream_chunk(
        _stream_event(
            chunk_type=ChunkType.TOOL_RESULT,
            chunk="output/",
            tool_result=ToolResult(
                id="tool-call-1",
                name="bash",
                output="output/",
                files=["https://example.com/report.pdf"],
                status=ToolResultStatus.SUCCESS,
                elapsed_time=0.3,
                icon="light-icon",
                icon_dark="dark-icon",
            ),
        )
    )
    builder.add_stream_chunk(_stream_event(chunk_type=ChunkType.TEXT, chunk="Finished."))

    replay = builder.build(outputs={"files": [file_payload]})

    assert replay is not None
    assert replay["text"] == "I checked the directory.\nFinished."
    assert replay["files"] == [{"var_name": "files", "files": [file_payload]}]
    assert replay["llm_generation_items"] == [
        {
            "type": "thought",
            "thought_output": "Need to inspect the workspace.",
            "thought_completed": True,
        },
        {
            "type": "text",
            "text": "I checked the directory.\n",
            "text_completed": True,
        },
        {
            "type": "tool",
            "tool_name": "bash",
            "tool_arguments": "{\"command\": \"ls\"}",
            "tool_icon": "light-icon",
            "tool_icon_dark": "dark-icon",
            "tool_output": "output/",
            "tool_files": ["https://example.com/report.pdf"],
            "tool_duration": 0.3,
        },
        {
            "type": "text",
            "text": "Finished.",
            "text_completed": True,
        },
    ]


def test_workflow_result_replay_builder_synthesizes_items_from_generation_without_sequence() -> None:
    builder = WorkflowResultReplayBuilder()

    replay = builder.build(
        outputs={
            "generation": {
                "content": "Workspace is clean.",
                "reasoning_content": [],
                "tool_calls": [
                    {
                        "name": "bash",
                        "arguments": "{\"bash\":\"ls\"}",
                        "output": "output/",
                        "status": "success",
                        "elapsed_time": 0.2,
                    }
                ],
                "sequence": [],
            }
        }
    )

    assert replay is not None
    assert replay["text"] == "Workspace is clean."
    assert replay["llm_generation_items"] == [
        {
            "type": "tool",
            "tool_name": "bash",
            "tool_arguments": "{\"bash\":\"ls\"}",
            "tool_output": "output/",
            "tool_duration": 0.2,
        },
        {
            "type": "text",
            "text": "Workspace is clean.",
            "text_completed": True,
        },
    ]


def test_workflow_result_replay_builder_ignores_empty_terminal_stream_events() -> None:
    builder = WorkflowResultReplayBuilder()

    builder.add_stream_chunk(_stream_event(chunk_type=ChunkType.TEXT, chunk="Hello"))
    builder.add_stream_chunk(
        NodeRunStreamChunkEvent(
            id="execution-1",
            node_id="answer-node",
            node_type=NodeType.ANSWER,
            selector=["answer-node", "generation", "thought"],
            chunk="",
            is_final=True,
            chunk_type=ChunkType.THOUGHT,
        )
    )
    builder.add_stream_chunk(
        NodeRunStreamChunkEvent(
            id="execution-1",
            node_id="answer-node",
            node_type=NodeType.ANSWER,
            selector=["answer-node", "generation", "tool_calls"],
            chunk="",
            is_final=True,
            chunk_type=ChunkType.TOOL_CALL,
            tool_call=ToolCall(id="", name="", arguments=""),
        )
    )
    builder.add_stream_chunk(
        NodeRunStreamChunkEvent(
            id="execution-1",
            node_id="answer-node",
            node_type=NodeType.ANSWER,
            selector=["answer-node", "generation", "tool_results"],
            chunk="",
            is_final=True,
            chunk_type=ChunkType.TOOL_RESULT,
            tool_result=ToolResult(id="", name="", output="", files=[], status=ToolResultStatus.SUCCESS),
        )
    )

    replay = builder.build(outputs={"answer": "Hello"})

    assert replay is not None
    assert replay["llm_generation_items"] == [
        {
            "type": "text",
            "text": "Hello",
            "text_completed": True,
        },
    ]


def test_build_result_replay_from_node_executions_uses_llm_trace_when_outputs_are_flattened() -> None:
    node_execution = WorkflowNodeExecution(
        id="node-execution-1",
        node_execution_id="node-execution-1",
        workflow_id="workflow-1",
        workflow_execution_id="workflow-run-1",
        index=1,
        node_id="agent-node",
        node_type=NodeType.LLM,
        title="Agent",
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        outputs={
            "generation": {
                "content": "Workspace is clean.",
                "reasoning_content": [],
                "tool_calls": [],
                "sequence": [],
            }
        },
        metadata={
            WorkflowNodeExecutionMetadataKey.LLM_TRACE: [
                {
                    "type": "model",
                    "output": {
                        "text": "Let me inspect the workspace:",
                        "reasoning": None,
                        "tool_calls": [
                            {
                                "id": "tool-1",
                                "name": "bash",
                                "arguments": "{\"bash\":\"ls\"}",
                            }
                        ],
                    },
                },
                {
                    "type": "tool",
                    "duration": 0.2,
                    "status": "success",
                    "output": {
                        "id": "tool-1",
                        "name": "bash",
                        "arguments": "{\"bash\":\"ls\"}",
                        "output": "output/",
                    },
                },
                {
                    "type": "model",
                    "output": {
                        "text": "Workspace is clean.",
                        "reasoning": None,
                        "tool_calls": [],
                    },
                },
            ]
        },
        created_at=datetime.utcnow(),
    )

    replay = build_result_replay_from_node_executions(
        outputs={"answer": "Workspace is clean."},
        node_executions=[node_execution],
    )

    assert replay is not None
    assert replay["text"] == "Workspace is clean."
    assert replay["llm_generation_items"] == [
        {
            "type": "text",
            "text": "Let me inspect the workspace:",
            "text_completed": True,
        },
        {
            "type": "tool",
            "tool_name": "bash",
            "tool_arguments": "{\"bash\":\"ls\"}",
            "tool_output": "output/",
            "tool_duration": 0.2,
        },
        {
            "type": "text",
            "text": "Workspace is clean.",
            "text_completed": True,
        },
    ]
