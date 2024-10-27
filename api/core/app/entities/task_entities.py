from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict

from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.utils.encoders import jsonable_encoder
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeType
from core.workflow.nodes.answer.entities import GenerateRouteChunk
from models.workflow import WorkflowNodeExecutionStatus


class WorkflowStreamGenerateNodes(BaseModel):
    """
    WorkflowStreamGenerateNodes entity
    """
    end_node_id: str
    stream_node_ids: list[str]


class ChatflowStreamGenerateRoute(BaseModel):
    """
    ChatflowStreamGenerateRoute entity
    """
    answer_node_id: str
    generate_route: list[GenerateRouteChunk]
    current_route_position: int = 0


class NodeExecutionInfo(BaseModel):
    """
    NodeExecutionInfo entity
    """
    workflow_node_execution_id: str
    node_type: NodeType
    start_at: float


class TaskState(BaseModel):
    """
    TaskState entity
    """
    metadata: dict = {}


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

    workflow_run_id: Optional[str] = None
    start_at: Optional[float] = None
    total_tokens: int = 0
    total_steps: int = 0

    ran_node_execution_infos: dict[str, NodeExecutionInfo] = {}
    latest_node_execution_info: Optional[NodeExecutionInfo] = None

    current_stream_generate_state: Optional[WorkflowStreamGenerateNodes] = None

    iteration_nested_node_ids: list[str] = None


class AdvancedChatTaskState(WorkflowTaskState):
    """
    AdvancedChatTaskState entity
    """
    usage: LLMUsage

    current_stream_generate_state: Optional[ChatflowStreamGenerateRoute] = None


class StreamEvent(Enum):
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
    ITERATION_STARTED = "iteration_started"
    ITERATION_NEXT = "iteration_next"
    ITERATION_COMPLETED = "iteration_completed"
    TEXT_CHUNK = "text_chunk"
    TEXT_REPLACE = "text_replace"


class StreamResponse(BaseModel):
    """
    StreamResponse entity
    """
    event: StreamEvent
    task_id: str

    def to_dict(self) -> dict:
        return jsonable_encoder(self)


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
    metadata: dict = {}


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


class AgentThoughtStreamResponse(StreamResponse):
    """
    AgentThoughtStreamResponse entity
    """
    event: StreamEvent = StreamEvent.AGENT_THOUGHT
    id: str
    position: int
    thought: Optional[str] = None
    observation: Optional[str] = None
    tool: Optional[str] = None
    tool_labels: Optional[dict] = None
    tool_input: Optional[str] = None
    message_files: Optional[list[str]] = None


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
        sequence_number: int
        inputs: dict
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
        sequence_number: int
        status: str
        outputs: Optional[dict] = None
        error: Optional[str] = None
        elapsed_time: float
        total_tokens: int
        total_steps: int
        created_by: Optional[dict] = None
        created_at: int
        finished_at: int
        files: Optional[list[dict]] = []

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
        predecessor_node_id: Optional[str] = None
        inputs: Optional[dict] = None
        created_at: int
        extras: dict = {}

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
                "extras": {}
            }
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
        predecessor_node_id: Optional[str] = None
        inputs: Optional[dict] = None
        process_data: Optional[dict] = None
        outputs: Optional[dict] = None
        status: str
        error: Optional[str] = None
        elapsed_time: float
        execution_metadata: Optional[dict] = None
        created_at: int
        finished_at: int
        files: Optional[list[dict]] = []

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
                "files": []
            }
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
        extras: dict = {}
        metadata: dict = {}
        inputs: dict = {}

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
        pre_iteration_output: Optional[Any] = None
        extras: dict = {}

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
        outputs: Optional[dict] = None
        created_at: int
        extras: dict = None
        inputs: dict = None
        status: WorkflowNodeExecutionStatus
        error: Optional[str] = None
        elapsed_time: float
        total_tokens: int
        execution_metadata: Optional[dict] = None
        finished_at: int
        steps: int

    event: StreamEvent = StreamEvent.ITERATION_COMPLETED
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
    workflow_run_id: str


class AppBlockingResponse(BaseModel):
    """
    AppBlockingResponse entity
    """
    task_id: str

    def to_dict(self) -> dict:
        return jsonable_encoder(self)


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
        metadata: dict = {}
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
        metadata: dict = {}
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
        outputs: Optional[dict] = None
        error: Optional[str] = None
        elapsed_time: float
        total_tokens: int
        total_steps: int
        created_at: int
        finished_at: int

    workflow_run_id: str
    data: Data


class WorkflowIterationState(BaseModel):
    """
    WorkflowIterationState entity
    """

    class Data(BaseModel):
        """
        Data entity
        """
        parent_iteration_id: Optional[str] = None
        iteration_id: str
        current_index: int
        iteration_steps_boundary: list[int] = None
        node_execution_id: str
        started_at: float
        inputs: dict = None
        total_tokens: int = 0
        node_data: BaseNodeData

    current_iterations: dict[str, Data] = None
