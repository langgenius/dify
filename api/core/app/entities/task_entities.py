from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.workflow.entities import AgentNodeStrategyInit
from core.workflow.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus


class AnnotationReplyAccount(BaseModel):
    id: str
    name: str


class AnnotationReply(BaseModel):
    id: str
    account: AnnotationReplyAccount


class TaskStateMetadata(BaseModel):
    annotation_reply: AnnotationReply | None = None
    retriever_resources: Sequence[RetrievalSourceMetadata] = Field(default_factory=list)
    usage: LLMUsage | None = None


class TaskState(BaseModel):
    """
    TaskState entity
    """

    metadata: TaskStateMetadata = Field(default_factory=TaskStateMetadata)


class EasyUITaskState(TaskState):
    """
    EasyUITaskState entity
    """

    llm_result: LLMResult


class WorkflowTaskState(TaskState):
    """
    WorkflowTaskState entity
    """

    answer: str = ""
    first_token_time: float | None = None
    last_token_time: float | None = None
    is_streaming_response: bool = False


class StreamEvent(StrEnum):
    """
    Stream event
    """

    PING = "ping"
    ERROR = "error"
    MESSAGE = "message"
    MESSAGE_END = "message_end"
    TTS_MESSAGE = "tts_message"
    TTS_MESSAGE_END = "tts_message_end"
    MESSAGE_FILE = "message_file"
    MESSAGE_REPLACE = "message_replace"
    AGENT_THOUGHT = "agent_thought"
    AGENT_MESSAGE = "agent_message"
    WORKFLOW_STARTED = "workflow_started"
    WORKFLOW_FINISHED = "workflow_finished"
    NODE_STARTED = "node_started"
    NODE_FINISHED = "node_finished"
    NODE_RETRY = "node_retry"
    ITERATION_STARTED = "iteration_started"
    ITERATION_NEXT = "iteration_next"
    ITERATION_COMPLETED = "iteration_completed"
    LOOP_STARTED = "loop_started"
    LOOP_NEXT = "loop_next"
    LOOP_COMPLETED = "loop_completed"
    TEXT_CHUNK = "text_chunk"
    TEXT_REPLACE = "text_replace"
    AGENT_LOG = "agent_log"


class StreamResponse(BaseModel):
    """
    StreamResponse entity
    """

    event: StreamEvent
    task_id: str


class ErrorStreamResponse(StreamResponse):
    """
    ErrorStreamResponse entity
    """

    event: StreamEvent = StreamEvent.ERROR
    err: Exception
    model_config = ConfigDict(arbitrary_types_allowed=True)


class MessageStreamResponse(StreamResponse):
    """
    MessageStreamResponse entity
    """

    event: StreamEvent = StreamEvent.MESSAGE
    id: str
    answer: str
    from_variable_selector: list[str] | None = None


class MessageAudioStreamResponse(StreamResponse):
    """
    MessageStreamResponse entity
    """

    event: StreamEvent = StreamEvent.TTS_MESSAGE
    audio: str


class MessageAudioEndStreamResponse(StreamResponse):
    """
    MessageStreamResponse entity
    """

    event: StreamEvent = StreamEvent.TTS_MESSAGE_END
    audio: str


class MessageEndStreamResponse(StreamResponse):
    """
    MessageEndStreamResponse entity
    """

    event: StreamEvent = StreamEvent.MESSAGE_END
    id: str
    metadata: Mapping[str, object] = Field(default_factory=dict)
    files: Sequence[Mapping[str, Any]] | None = None


class MessageFileStreamResponse(StreamResponse):
    """
    MessageFileStreamResponse entity
    """

    event: StreamEvent = StreamEvent.MESSAGE_FILE
    id: str
    type: str
    belongs_to: str
    url: str


class MessageReplaceStreamResponse(StreamResponse):
    """
    MessageReplaceStreamResponse entity
    """

    event: StreamEvent = StreamEvent.MESSAGE_REPLACE
    answer: str
    reason: str


class AgentThoughtStreamResponse(StreamResponse):
    """
    AgentThoughtStreamResponse entity
    """

    event: StreamEvent = StreamEvent.AGENT_THOUGHT
    id: str
    position: int
    thought: str | None = None
    observation: str | None = None
    tool: str | None = None
    tool_labels: Mapping[str, object] = Field(default_factory=dict)
    tool_input: str | None = None
    message_files: list[str] | None = None


class AgentMessageStreamResponse(StreamResponse):
    """
    AgentMessageStreamResponse entity
    """

    event: StreamEvent = StreamEvent.AGENT_MESSAGE
    id: str
    answer: str


class WorkflowStartStreamResponse(StreamResponse):
    """
    WorkflowStartStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        workflow_id: str
        inputs: Mapping[str, Any]
        created_at: int

    event: StreamEvent = StreamEvent.WORKFLOW_STARTED
    workflow_run_id: str
    data: Data


class WorkflowFinishStreamResponse(StreamResponse):
    """
    WorkflowFinishStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        workflow_id: str
        status: str
        outputs: Mapping[str, Any] | None = None
        error: str | None = None
        elapsed_time: float
        total_tokens: int
        total_steps: int
        created_by: Mapping[str, object] = Field(default_factory=dict)
        created_at: int
        finished_at: int
        exceptions_count: int | None = 0
        files: Sequence[Mapping[str, Any]] | None = []

    event: StreamEvent = StreamEvent.WORKFLOW_FINISHED
    workflow_run_id: str
    data: Data


class NodeStartStreamResponse(StreamResponse):
    """
    NodeStartStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        node_id: str
        node_type: str
        title: str
        index: int
        predecessor_node_id: str | None = None
        inputs: Mapping[str, Any] | None = None
        inputs_truncated: bool = False
        created_at: int
        extras: dict[str, object] = Field(default_factory=dict)
        iteration_id: str | None = None
        loop_id: str | None = None
        agent_strategy: AgentNodeStrategyInit | None = None

    event: StreamEvent = StreamEvent.NODE_STARTED
    workflow_run_id: str
    data: Data

    def to_ignore_detail_dict(self):
        return {
            "event": self.event.value,
            "task_id": self.task_id,
            "workflow_run_id": self.workflow_run_id,
            "data": {
                "id": self.data.id,
                "node_id": self.data.node_id,
                "node_type": self.data.node_type,
                "title": self.data.title,
                "index": self.data.index,
                "predecessor_node_id": self.data.predecessor_node_id,
                "inputs": None,
                "created_at": self.data.created_at,
                "extras": {},
                "iteration_id": self.data.iteration_id,
                "loop_id": self.data.loop_id,
            },
        }


class NodeFinishStreamResponse(StreamResponse):
    """
    NodeFinishStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        node_id: str
        node_type: str
        title: str
        index: int
        predecessor_node_id: str | None = None
        inputs: Mapping[str, Any] | None = None
        inputs_truncated: bool = False
        process_data: Mapping[str, Any] | None = None
        process_data_truncated: bool = False
        outputs: Mapping[str, Any] | None = None
        outputs_truncated: bool = True
        status: str
        error: str | None = None
        elapsed_time: float
        execution_metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] | None = None
        created_at: int
        finished_at: int
        files: Sequence[Mapping[str, Any]] | None = []
        iteration_id: str | None = None
        loop_id: str | None = None

    event: StreamEvent = StreamEvent.NODE_FINISHED
    workflow_run_id: str
    data: Data

    def to_ignore_detail_dict(self):
        return {
            "event": self.event.value,
            "task_id": self.task_id,
            "workflow_run_id": self.workflow_run_id,
            "data": {
                "id": self.data.id,
                "node_id": self.data.node_id,
                "node_type": self.data.node_type,
                "title": self.data.title,
                "index": self.data.index,
                "predecessor_node_id": self.data.predecessor_node_id,
                "inputs": None,
                "process_data": None,
                "outputs": None,
                "status": self.data.status,
                "error": None,
                "elapsed_time": self.data.elapsed_time,
                "execution_metadata": None,
                "created_at": self.data.created_at,
                "finished_at": self.data.finished_at,
                "files": [],
                "iteration_id": self.data.iteration_id,
                "loop_id": self.data.loop_id,
            },
        }


class NodeRetryStreamResponse(StreamResponse):
    """
    NodeFinishStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        node_id: str
        node_type: str
        title: str
        index: int
        predecessor_node_id: str | None = None
        inputs: Mapping[str, Any] | None = None
        inputs_truncated: bool = False
        process_data: Mapping[str, Any] | None = None
        process_data_truncated: bool = False
        outputs: Mapping[str, Any] | None = None
        outputs_truncated: bool = False
        status: str
        error: str | None = None
        elapsed_time: float
        execution_metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] | None = None
        created_at: int
        finished_at: int
        files: Sequence[Mapping[str, Any]] | None = []
        iteration_id: str | None = None
        loop_id: str | None = None
        retry_index: int = 0

    event: StreamEvent = StreamEvent.NODE_RETRY
    workflow_run_id: str
    data: Data

    def to_ignore_detail_dict(self):
        return {
            "event": self.event.value,
            "task_id": self.task_id,
            "workflow_run_id": self.workflow_run_id,
            "data": {
                "id": self.data.id,
                "node_id": self.data.node_id,
                "node_type": self.data.node_type,
                "title": self.data.title,
                "index": self.data.index,
                "predecessor_node_id": self.data.predecessor_node_id,
                "inputs": None,
                "process_data": None,
                "outputs": None,
                "status": self.data.status,
                "error": None,
                "elapsed_time": self.data.elapsed_time,
                "execution_metadata": None,
                "created_at": self.data.created_at,
                "finished_at": self.data.finished_at,
                "files": [],
                "iteration_id": self.data.iteration_id,
                "loop_id": self.data.loop_id,
                "retry_index": self.data.retry_index,
            },
        }


class IterationNodeStartStreamResponse(StreamResponse):
    """
    NodeStartStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        node_id: str
        node_type: str
        title: str
        created_at: int
        extras: dict = Field(default_factory=dict)
        metadata: Mapping = {}
        inputs: Mapping = {}
        inputs_truncated: bool = False

    event: StreamEvent = StreamEvent.ITERATION_STARTED
    workflow_run_id: str
    data: Data


class IterationNodeNextStreamResponse(StreamResponse):
    """
    NodeStartStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        node_id: str
        node_type: str
        title: str
        index: int
        created_at: int
        extras: dict = Field(default_factory=dict)

    event: StreamEvent = StreamEvent.ITERATION_NEXT
    workflow_run_id: str
    data: Data


class IterationNodeCompletedStreamResponse(StreamResponse):
    """
    NodeCompletedStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        node_id: str
        node_type: str
        title: str
        outputs: Mapping | None = None
        outputs_truncated: bool = False
        created_at: int
        extras: dict | None = None
        inputs: Mapping | None = None
        inputs_truncated: bool = False
        status: WorkflowNodeExecutionStatus
        error: str | None = None
        elapsed_time: float
        total_tokens: int
        execution_metadata: Mapping[str, object] = Field(default_factory=dict)
        finished_at: int
        steps: int

    event: StreamEvent = StreamEvent.ITERATION_COMPLETED
    workflow_run_id: str
    data: Data


class LoopNodeStartStreamResponse(StreamResponse):
    """
    NodeStartStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        node_id: str
        node_type: str
        title: str
        created_at: int
        extras: dict = Field(default_factory=dict)
        metadata: Mapping = {}
        inputs: Mapping = {}
        inputs_truncated: bool = False

    event: StreamEvent = StreamEvent.LOOP_STARTED
    workflow_run_id: str
    data: Data


class LoopNodeNextStreamResponse(StreamResponse):
    """
    NodeStartStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        node_id: str
        node_type: str
        title: str
        index: int
        created_at: int
        pre_loop_output: Any = None
        extras: Mapping[str, object] = Field(default_factory=dict)

    event: StreamEvent = StreamEvent.LOOP_NEXT
    workflow_run_id: str
    data: Data


class LoopNodeCompletedStreamResponse(StreamResponse):
    """
    NodeCompletedStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        node_id: str
        node_type: str
        title: str
        outputs: Mapping | None = None
        outputs_truncated: bool = False
        created_at: int
        extras: dict | None = None
        inputs: Mapping | None = None
        inputs_truncated: bool = False
        status: WorkflowNodeExecutionStatus
        error: str | None = None
        elapsed_time: float
        total_tokens: int
        execution_metadata: Mapping[str, object] = Field(default_factory=dict)
        finished_at: int
        steps: int

    event: StreamEvent = StreamEvent.LOOP_COMPLETED
    workflow_run_id: str
    data: Data


class TextChunkStreamResponse(StreamResponse):
    """
    TextChunkStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        text: str
        from_variable_selector: list[str] | None = None

    event: StreamEvent = StreamEvent.TEXT_CHUNK
    data: Data


class TextReplaceStreamResponse(StreamResponse):
    """
    TextReplaceStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        text: str

    event: StreamEvent = StreamEvent.TEXT_REPLACE
    data: Data


class PingStreamResponse(StreamResponse):
    """
    PingStreamResponse entity
    """

    event: StreamEvent = StreamEvent.PING


class AppStreamResponse(BaseModel):
    """
    AppStreamResponse entity
    """

    stream_response: StreamResponse


class ChatbotAppStreamResponse(AppStreamResponse):
    """
    ChatbotAppStreamResponse entity
    """

    conversation_id: str
    message_id: str
    created_at: int


class CompletionAppStreamResponse(AppStreamResponse):
    """
    CompletionAppStreamResponse entity
    """

    message_id: str
    created_at: int


class WorkflowAppStreamResponse(AppStreamResponse):
    """
    WorkflowAppStreamResponse entity
    """

    workflow_run_id: str | None = None


class AppBlockingResponse(BaseModel):
    """
    AppBlockingResponse entity
    """

    task_id: str


class ChatbotAppBlockingResponse(AppBlockingResponse):
    """
    ChatbotAppBlockingResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        mode: str
        conversation_id: str
        message_id: str
        answer: str
        metadata: Mapping[str, object] = Field(default_factory=dict)
        created_at: int

    data: Data


class CompletionAppBlockingResponse(AppBlockingResponse):
    """
    CompletionAppBlockingResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        mode: str
        message_id: str
        answer: str
        metadata: Mapping[str, object] = Field(default_factory=dict)
        created_at: int

    data: Data


class WorkflowAppBlockingResponse(AppBlockingResponse):
    """
    WorkflowAppBlockingResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        id: str
        workflow_id: str
        status: str
        outputs: Mapping[str, Any] | None = None
        error: str | None = None
        elapsed_time: float
        total_tokens: int
        total_steps: int
        created_at: int
        finished_at: int

    workflow_run_id: str
    data: Data


class AgentLogStreamResponse(StreamResponse):
    """
    AgentLogStreamResponse entity
    """

    class Data(BaseModel):
        """
        Data entity
        """

        node_execution_id: str
        id: str
        label: str
        parent_id: str | None = None
        error: str | None = None
        status: str
        data: Mapping[str, Any]
        metadata: Mapping[str, object] = Field(default_factory=dict)
        node_id: str

    event: StreamEvent = StreamEvent.AGENT_LOG
    data: Data
