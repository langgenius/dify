import re
from collections.abc import Mapping, Sequence
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.agent.entities import AgentLog, AgentResult
from core.file import File
from core.model_runtime.entities import ImagePromptMessageContent, LLMMode
from core.model_runtime.entities.llm_entities import LLMUsage
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.entities import ToolCallResult
from core.workflow.node_events import AgentLogEvent
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.base.entities import VariableSelector


class ModelConfig(BaseModel):
    provider: str
    name: str
    mode: LLMMode
    completion_params: dict[str, Any] = Field(default_factory=dict)


class ContextConfig(BaseModel):
    enabled: bool
    variable_selector: list[str] | None = None


class VisionConfigOptions(BaseModel):
    variable_selector: Sequence[str] = Field(default_factory=lambda: ["sys", "files"])
    detail: ImagePromptMessageContent.DETAIL = ImagePromptMessageContent.DETAIL.HIGH


class VisionConfig(BaseModel):
    enabled: bool = False
    configs: VisionConfigOptions = Field(default_factory=VisionConfigOptions)

    @field_validator("configs", mode="before")
    @classmethod
    def convert_none_configs(cls, v: Any):
        if v is None:
            return VisionConfigOptions()
        return v


class PromptConfig(BaseModel):
    jinja2_variables: Sequence[VariableSelector] = Field(default_factory=list)

    @field_validator("jinja2_variables", mode="before")
    @classmethod
    def convert_none_jinja2_variables(cls, v: Any):
        if v is None:
            return []
        return v


class LLMNodeChatModelMessage(ChatModelMessage):
    text: str = ""
    jinja2_text: str | None = None


class LLMNodeCompletionModelPromptTemplate(CompletionModelPromptTemplate):
    jinja2_text: str | None = None


class ToolMetadata(BaseModel):
    """
    Tool metadata for LLM node with tool support.

    Defines the essential fields needed for tool configuration,
    particularly the 'type' field to identify tool provider type.
    """

    # Core fields
    enabled: bool = True
    type: ToolProviderType = Field(..., description="Tool provider type: builtin, api, mcp, workflow")
    provider_name: str = Field(..., description="Tool provider name/identifier")
    tool_name: str = Field(..., description="Tool name")

    # Optional fields
    plugin_unique_identifier: str | None = Field(None, description="Plugin unique identifier for plugin tools")
    credential_id: str | None = Field(None, description="Credential ID for tools requiring authentication")

    # Configuration fields
    parameters: dict[str, Any] = Field(default_factory=dict, description="Tool parameters")
    settings: dict[str, Any] = Field(default_factory=dict, description="Tool settings configuration")
    extra: dict[str, Any] = Field(default_factory=dict, description="Extra tool configuration like custom description")


class LLMTraceSegment(BaseModel):
    """
    Streaming trace segment for LLM tool-enabled runs.

    Order is preserved for replay. Tool calls are single entries containing both
    arguments and results.
    """

    type: Literal["thought", "content", "tool_call"]

    # Common optional fields
    text: str | None = Field(None, description="Text chunk for thought/content")

    # Tool call fields (combined start + result)
    tool_call: ToolCallResult | None = Field(
        default=None,
        description="Combined tool call arguments and result for this segment",
    )


class LLMGenerationData(BaseModel):
    """Generation data from LLM invocation with tools.

    For multi-turn tool calls like: thought1 -> text1 -> tool_call1 -> thought2 -> text2 -> tool_call2
    - reasoning_contents: [thought1, thought2, ...] - one element per turn
    - tool_calls: [{id, name, arguments, result}, ...] - all tool calls with results
    """

    text: str = Field(..., description="Accumulated text content from all turns")
    reasoning_contents: list[str] = Field(default_factory=list, description="Reasoning content per turn")
    tool_calls: list[ToolCallResult] = Field(default_factory=list, description="Tool calls with results")
    sequence: list[dict[str, Any]] = Field(default_factory=list, description="Ordered segments for rendering")
    usage: LLMUsage = Field(..., description="LLM usage statistics")
    finish_reason: str | None = Field(None, description="Finish reason from LLM")
    files: list[File] = Field(default_factory=list, description="Generated files")
    trace: list[LLMTraceSegment] = Field(default_factory=list, description="Streaming trace in emitted order")


class ThinkTagStreamParser:
    """Lightweight state machine to split streaming chunks by <think> tags."""

    _START_PATTERN = re.compile(r"<think(?:\s[^>]*)?>", re.IGNORECASE)
    _END_PATTERN = re.compile(r"</think>", re.IGNORECASE)
    _START_PREFIX = "<think"
    _END_PREFIX = "</think"

    def __init__(self):
        self._buffer = ""
        self._in_think = False

    @staticmethod
    def _suffix_prefix_len(text: str, prefix: str) -> int:
        """Return length of the longest suffix of `text` that is a prefix of `prefix`."""
        max_len = min(len(text), len(prefix) - 1)
        for i in range(max_len, 0, -1):
            if text[-i:].lower() == prefix[:i].lower():
                return i
        return 0

    def process(self, chunk: str) -> list[tuple[str, str]]:
        """
        Split incoming chunk into ('thought' | 'text', content) tuples.
        Content excludes the <think> tags themselves and handles split tags across chunks.
        """
        parts: list[tuple[str, str]] = []
        self._buffer += chunk

        while self._buffer:
            if self._in_think:
                end_match = self._END_PATTERN.search(self._buffer)
                if end_match:
                    thought_text = self._buffer[: end_match.start()]
                    if thought_text:
                        parts.append(("thought", thought_text))
                    parts.append(("thought_end", ""))
                    self._buffer = self._buffer[end_match.end() :]
                    self._in_think = False
                    continue

                hold_len = self._suffix_prefix_len(self._buffer, self._END_PREFIX)
                emit = self._buffer[: len(self._buffer) - hold_len]
                if emit:
                    parts.append(("thought", emit))
                self._buffer = self._buffer[-hold_len:] if hold_len > 0 else ""
                break

            start_match = self._START_PATTERN.search(self._buffer)
            if start_match:
                prefix = self._buffer[: start_match.start()]
                if prefix:
                    parts.append(("text", prefix))
                self._buffer = self._buffer[start_match.end() :]
                parts.append(("thought_start", ""))
                self._in_think = True
                continue

            hold_len = self._suffix_prefix_len(self._buffer, self._START_PREFIX)
            emit = self._buffer[: len(self._buffer) - hold_len]
            if emit:
                parts.append(("text", emit))
            self._buffer = self._buffer[-hold_len:] if hold_len > 0 else ""
            break

        cleaned_parts: list[tuple[str, str]] = []
        for kind, content in parts:
            # Extra safeguard: strip any stray tags that slipped through.
            content = self._START_PATTERN.sub("", content)
            content = self._END_PATTERN.sub("", content)
            if content or kind in {"thought_start", "thought_end"}:
                cleaned_parts.append((kind, content))

        return cleaned_parts

    def flush(self) -> list[tuple[str, str]]:
        """Flush remaining buffer when the stream ends."""
        if not self._buffer:
            return []
        kind = "thought" if self._in_think else "text"
        content = self._buffer
        # Drop dangling partial tags instead of emitting them
        if content.lower().startswith(self._START_PREFIX) or content.lower().startswith(self._END_PREFIX):
            content = ""
        self._buffer = ""
        if not content and not self._in_think:
            return []
        # Strip any complete tags that might still be present.
        content = self._START_PATTERN.sub("", content)
        content = self._END_PATTERN.sub("", content)

        result: list[tuple[str, str]] = []
        if content:
            result.append((kind, content))
        if self._in_think:
            result.append(("thought_end", ""))
            self._in_think = False
        return result


class StreamBuffers(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    think_parser: ThinkTagStreamParser = Field(default_factory=ThinkTagStreamParser)
    pending_thought: list[str] = Field(default_factory=list)
    pending_content: list[str] = Field(default_factory=list)
    current_turn_reasoning: list[str] = Field(default_factory=list)
    reasoning_per_turn: list[str] = Field(default_factory=list)


class TraceState(BaseModel):
    trace_segments: list[LLMTraceSegment] = Field(default_factory=list)
    tool_trace_map: dict[str, LLMTraceSegment] = Field(default_factory=dict)
    tool_call_index_map: dict[str, int] = Field(default_factory=dict)


class AggregatedResult(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    text: str = ""
    files: list[File] = Field(default_factory=list)
    usage: LLMUsage = Field(default_factory=LLMUsage.empty_usage)
    finish_reason: str | None = None


class AgentContext(BaseModel):
    agent_logs: list[AgentLogEvent] = Field(default_factory=list)
    agent_result: AgentResult | None = None


class ToolOutputState(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    stream: StreamBuffers = Field(default_factory=StreamBuffers)
    trace: TraceState = Field(default_factory=TraceState)
    aggregate: AggregatedResult = Field(default_factory=AggregatedResult)
    agent: AgentContext = Field(default_factory=AgentContext)


class ToolLogPayload(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    tool_name: str = ""
    tool_call_id: str = ""
    tool_args: dict[str, Any] = Field(default_factory=dict)
    tool_output: Any = None
    tool_error: Any = None
    files: list[Any] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_log(cls, log: AgentLog) -> "ToolLogPayload":
        data = log.data or {}
        return cls(
            tool_name=data.get("tool_name", ""),
            tool_call_id=data.get("tool_call_id", ""),
            tool_args=data.get("tool_args") or {},
            tool_output=data.get("output"),
            tool_error=data.get("error"),
            files=data.get("files") or [],
            meta=data.get("meta") or {},
        )

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> "ToolLogPayload":
        return cls(
            tool_name=data.get("tool_name", ""),
            tool_call_id=data.get("tool_call_id", ""),
            tool_args=data.get("tool_args") or {},
            tool_output=data.get("output"),
            tool_error=data.get("error"),
            files=data.get("files") or [],
            meta=data.get("meta") or {},
        )


class LLMNodeData(BaseNodeData):
    model: ModelConfig
    prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate
    prompt_config: PromptConfig = Field(default_factory=PromptConfig)
    memory: MemoryConfig | None = None
    context: ContextConfig
    vision: VisionConfig = Field(default_factory=VisionConfig)
    structured_output: Mapping[str, Any] | None = None
    # We used 'structured_output_enabled' in the past, but it's not a good name.
    structured_output_switch_on: bool = Field(False, alias="structured_output_enabled")
    reasoning_format: Literal["separated", "tagged"] = Field(
        # Keep tagged as default for backward compatibility
        default="tagged",
        description=(
            """
            Strategy for handling model reasoning output.

            separated: Return clean text (without <think> tags) + reasoning_content field.
                      Recommended for new workflows. Enables safe downstream parsing and 
                      workflow variable access: {{#node_id.reasoning_content#}}

            tagged   : Return original text (with <think> tags) + reasoning_content field.
                      Maintains full backward compatibility while still providing reasoning_content
                      for workflow automation. Frontend thinking panels work as before.
            """
        ),
    )

    # Tool support
    tools: Sequence[ToolMetadata] = Field(default_factory=list)
    max_iterations: int | None = Field(default=None, description="Maximum number of iterations for the LLM node")

    @field_validator("prompt_config", mode="before")
    @classmethod
    def convert_none_prompt_config(cls, v: Any):
        if v is None:
            return PromptConfig()
        return v

    @property
    def structured_output_enabled(self) -> bool:
        return self.structured_output_switch_on and self.structured_output is not None
