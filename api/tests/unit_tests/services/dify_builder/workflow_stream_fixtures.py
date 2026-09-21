"""Native debugger payloads shared by Builder adapter and wire-contract tests."""

from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.entities import task_entities as events


def _native_responses() -> list[events.StreamResponse]:
    data = {
        "id": "execution-1",
        "workflow_id": "workflow-1",
        "workflow_run_id": "run-1",
        "node_id": "node-1",
        "node_execution_id": "execution-1",
        "node_type": "code",
        "title": "Code",
        "index": 1,
        "predecessor_node_id": "start",
        "inputs": {"query": "hello"},
        "inputs_truncated": True,
        "process_data": {"nested": {"values": [1, 2]}},
        "process_data_truncated": True,
        "outputs": {"answer": "42"},
        "outputs_truncated": True,
        "status": "succeeded",
        "elapsed_time": 1.5,
        "total_tokens": 10,
        "total_steps": 2,
        "steps": 2,
        "created_at": 1,
        "finished_at": 2,
        "iteration_id": "iteration-1",
        "loop_id": "loop-1",
        "retry_index": 2,
        "execution_metadata": {"total_tokens": 10, "iteration_index": 1},
        "metadata": {"iterator_length": 2, "loop_length": 2},
        "text": "answer",
        "reasoning": "reasoning",
        "is_final": True,
        "label": "Tool call",
        "data": {"tool_output": "42"},
        "node_title": "Approval",
        "form_id": "form-1",
        "form_content": "Approve?",
        "expiration_time": 10,
        "rendered_content": "Approved",
        "action_id": "approve",
        "action_text": "Approve",
        "submitted_data": {"comment": "Proceed"},
    }
    models = [
        events.WorkflowStartStreamResponse,
        events.NodeStartStreamResponse,
        events.NodeRetryStreamResponse,
        events.NodeFinishStreamResponse,
        events.IterationNodeStartStreamResponse,
        events.IterationNodeNextStreamResponse,
        events.IterationNodeCompletedStreamResponse,
        events.LoopNodeStartStreamResponse,
        events.LoopNodeNextStreamResponse,
        events.LoopNodeCompletedStreamResponse,
        events.TextChunkStreamResponse,
        events.TextReplaceStreamResponse,
        events.ReasoningChunkStreamResponse,
        events.AgentLogStreamResponse,
        events.HumanInputRequiredResponse,
        events.HumanInputFormFilledResponse,
        events.HumanInputFormTimeoutResponse,
        events.WorkflowPauseStreamResponse,
        events.WorkflowFinishStreamResponse,
        events.MessageAudioStreamResponse,
        events.MessageAudioEndStreamResponse,
    ]
    responses = []
    for model in models:
        event_data = dict(data)
        if model is events.HumanInputRequiredResponse:
            event_data["inputs"] = []
        if model is events.WorkflowPauseStreamResponse:
            event_data["status"] = "paused"
        response = model.model_validate(
            {"task_id": "task-1", "workflow_run_id": "run-1", "data": event_data, "audio": "audio"}
        )
        responses.append(response)
    responses.append(events.ErrorStreamResponse(task_id="task-1", err=ValueError("Bad input")))
    return responses


def native_workflow_payloads() -> list[dict]:
    converted = WorkflowAppGenerateResponseConverter.convert_stream_full_response(
        events.WorkflowAppStreamResponse(stream_response=response, workflow_run_id="run-1")
        for response in _native_responses()
    )
    return [payload for payload in converted if isinstance(payload, dict)]


def native_chatflow_payloads() -> list[dict]:
    responses = [
        *_native_responses(),
        events.MessageStreamResponse(
            task_id="task-1", id="message-1", answer="answer", from_variable_selector=["answer", "text"]
        ),
        events.MessageEndStreamResponse(task_id="task-1", id="message-1", metadata={"usage": {"total_tokens": 10}}),
        events.MessageFileStreamResponse(
            task_id="task-1", id="file-1", type="image", belongs_to="assistant", url="/files/image.png"
        ),
        events.MessageReplaceStreamResponse(task_id="task-1", answer="replacement", reason="moderation"),
    ]
    converted = AdvancedChatAppGenerateResponseConverter.convert_stream_full_response(
        events.ChatbotAppStreamResponse(
            stream_response=response, conversation_id="conversation-1", message_id="message-1", created_at=1
        )
        for response in responses
    )
    return [payload for payload in converted if isinstance(payload, dict)]
