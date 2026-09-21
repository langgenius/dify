"""Full debugger workflow stream payloads, using the runtime's data schemas.

Workflow adds workflow_run_id to every payload; Chatflow leaves it out of
message, text, reasoning, agent-log, audio, and error events. Errors are flat
and omit task_id. Preserve both native wire shapes inside Builder's envelope.
"""

from typing import Annotated, Literal

from pydantic import ConfigDict, Field

from core.app.entities import task_entities as events
from fields.base import ResponseModel


class WorkflowStreamEvent[Event: str, Data](ResponseModel):
    model_config = ConfigDict(extra="allow")

    event: Event
    task_id: str
    workflow_run_id: str
    data: Data


class WorkflowStreamDataEvent[Event: str, Data](ResponseModel):
    model_config = ConfigDict(extra="allow")

    event: Event
    task_id: str
    workflow_run_id: str | None = None
    data: Data


class WorkflowStreamError(ResponseModel):
    model_config = ConfigDict(extra="allow")

    event: Literal["error"]
    workflow_run_id: str | None = None
    code: str
    status: int
    message: str


class WorkflowStreamMessageEvent[Event: str](ResponseModel):
    model_config = ConfigDict(extra="allow")

    event: Event
    task_id: str
    workflow_run_id: str | None = None


class WorkflowStreamMessage(WorkflowStreamMessageEvent[Literal["message"]]):
    id: str
    answer: str
    from_variable_selector: list[str] = Field(default_factory=list)


class WorkflowStreamMessageEnd(WorkflowStreamMessageEvent[Literal["message_end"]]):
    id: str
    metadata: dict[str, object] = Field(default_factory=dict)
    files: list[dict[str, object]] = Field(default_factory=list)


class WorkflowStreamMessageFile(WorkflowStreamMessageEvent[Literal["message_file"]]):
    id: str
    type: str
    belongs_to: str
    url: str


class WorkflowStreamMessageReplace(WorkflowStreamMessageEvent[Literal["message_replace"]]):
    answer: str
    reason: str


class WorkflowStreamAudio(WorkflowStreamMessageEvent[Literal["tts_message", "tts_message_end"]]):
    audio: str
    audio_type: str | None = None


WorkflowStreamPayload = Annotated[
    WorkflowStreamEvent[Literal["workflow_started"], events.WorkflowStartStreamResponse.Data]
    | WorkflowStreamEvent[Literal["workflow_finished"], events.WorkflowFinishStreamResponse.Data]
    | WorkflowStreamEvent[Literal["workflow_paused"], events.WorkflowPauseStreamResponse.Data]
    | WorkflowStreamEvent[Literal["node_started"], events.NodeStartStreamResponse.Data]
    | WorkflowStreamEvent[Literal["node_finished"], events.NodeFinishStreamResponse.Data]
    | WorkflowStreamEvent[Literal["node_retry"], events.NodeRetryStreamResponse.Data]
    | WorkflowStreamEvent[Literal["iteration_started"], events.IterationNodeStartStreamResponse.Data]
    | WorkflowStreamEvent[Literal["iteration_next"], events.IterationNodeNextStreamResponse.Data]
    | WorkflowStreamEvent[Literal["iteration_completed"], events.IterationNodeCompletedStreamResponse.Data]
    | WorkflowStreamEvent[Literal["loop_started"], events.LoopNodeStartStreamResponse.Data]
    | WorkflowStreamEvent[Literal["loop_next"], events.LoopNodeNextStreamResponse.Data]
    | WorkflowStreamEvent[Literal["loop_completed"], events.LoopNodeCompletedStreamResponse.Data]
    | WorkflowStreamDataEvent[Literal["text_chunk"], events.TextChunkStreamResponse.Data]
    | WorkflowStreamDataEvent[Literal["text_replace"], events.TextReplaceStreamResponse.Data]
    | WorkflowStreamDataEvent[Literal["reasoning_chunk"], events.ReasoningChunkStreamResponse.Data]
    | WorkflowStreamDataEvent[Literal["agent_log"], events.AgentLogStreamResponse.Data]
    | WorkflowStreamEvent[Literal["human_input_required"], events.HumanInputRequiredResponse.Data]
    | WorkflowStreamEvent[Literal["human_input_form_filled"], events.HumanInputFormFilledResponse.Data]
    | WorkflowStreamEvent[Literal["human_input_form_timeout"], events.HumanInputFormTimeoutResponse.Data]
    | WorkflowStreamAudio
    | WorkflowStreamMessage
    | WorkflowStreamMessageEnd
    | WorkflowStreamMessageFile
    | WorkflowStreamMessageReplace
    | WorkflowStreamError,
    Field(discriminator="event"),
]
