"""
Agent Streaming Service for Dify.

This module provides utilities for managing agent API streaming responses,
including proper handling of tool calls, observations, and multi-turn
conversation streaming with correct event ordering.

Related Issue: #16220 - Agent API Streaming - tool_input and observation handling
"""

from collections.abc import Generator
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class StreamEventType(StrEnum):
    """Types of events in an agent streaming response."""

    MESSAGE_START = "message_start"
    MESSAGE_DELTA = "message_delta"
    MESSAGE_END = "message_end"
    TOOL_CALL_START = "tool_call_start"
    TOOL_CALL_DELTA = "tool_call_delta"
    TOOL_CALL_END = "tool_call_end"
    TOOL_RESULT = "tool_result"
    THOUGHT = "thought"
    ERROR = "error"
    HEARTBEAT = "heartbeat"


class ToolCallStatus(StrEnum):
    """Status of a tool call."""

    PENDING = "pending"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ToolCallRecord:
    """Record of a single tool call in the stream."""

    call_id: str
    tool_name: str
    tool_input: dict[str, Any] = field(default_factory=dict)
    observation: str | None = None
    status: ToolCallStatus = ToolCallStatus.PENDING
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    sequence_number: int = 0


@dataclass
class StreamChunk:
    """A chunk of data in the streaming response."""

    event_type: StreamEventType
    data: dict[str, Any]
    timestamp: datetime = field(default_factory=datetime.now)
    sequence_number: int = 0
    tool_call_id: str | None = None


class StreamConfig(BaseModel):
    """Configuration for streaming behavior."""

    heartbeat_interval_seconds: float = Field(default=15.0, ge=1.0, le=60.0)
    max_tool_calls_per_turn: int = Field(default=10, ge=1, le=50)
    tool_timeout_seconds: int = Field(default=30, ge=5, le=300)
    buffer_size: int = Field(default=100, ge=10, le=1000)
    enable_thought_streaming: bool = Field(default=True)
    enable_tool_input_streaming: bool = Field(default=True)
    deduplicate_events: bool = Field(default=True)


class StreamState(BaseModel):
    """Current state of the streaming session."""

    session_id: str
    is_active: bool = True
    current_turn: int = 0
    total_tokens: int = 0
    tool_calls_in_turn: int = 0
    last_event_time: datetime = Field(default_factory=datetime.now)
    pending_tool_calls: list[str] = Field(default_factory=list)
    completed_tool_calls: list[str] = Field(default_factory=list)


class StreamEvent(BaseModel):
    """A streaming event to be sent to the client."""

    event_type: StreamEventType
    sequence_number: int
    timestamp: datetime = Field(default_factory=datetime.now)
    data: dict[str, Any] = Field(default_factory=dict)
    tool_call_id: str | None = None
    is_final: bool = False


class AgentStreamingService:
    """
    Service for managing agent streaming responses.

    Provides functionality for:
    - Proper ordering of streaming events
    - Tool call tracking and deduplication
    - Multi-turn conversation handling
    - Event buffering and delivery
    """

    def __init__(self, config: StreamConfig | None = None):
        """Initialize the streaming service."""
        self.config = config or StreamConfig()
        self._sessions: dict[str, StreamState] = {}
        self._tool_calls: dict[str, dict[str, ToolCallRecord]] = {}
        self._event_buffer: dict[str, list[StreamChunk]] = {}
        self._sequence_counters: dict[str, int] = {}
        self._seen_events: dict[str, set[str]] = {}

    def create_session(self, session_id: str) -> StreamState:
        """
        Create a new streaming session.

        Args:
            session_id: Unique identifier for the session

        Returns:
            StreamState for the new session
        """
        state = StreamState(session_id=session_id)
        self._sessions[session_id] = state
        self._tool_calls[session_id] = {}
        self._event_buffer[session_id] = []
        self._sequence_counters[session_id] = 0
        self._seen_events[session_id] = set()
        return state

    def get_session(self, session_id: str) -> StreamState | None:
        """Get the state of a streaming session."""
        return self._sessions.get(session_id)

    def close_session(self, session_id: str) -> bool:
        """
        Close a streaming session.

        Args:
            session_id: ID of the session to close

        Returns:
            True if session was closed successfully
        """
        if session_id not in self._sessions:
            return False

        state = self._sessions[session_id]
        state.is_active = False

        self._tool_calls.pop(session_id, None)
        self._event_buffer.pop(session_id, None)
        self._sequence_counters.pop(session_id, None)
        self._seen_events.pop(session_id, None)

        return True

    def _get_next_sequence(self, session_id: str) -> int:
        """Get the next sequence number for a session."""
        current = self._sequence_counters.get(session_id, 0)
        self._sequence_counters[session_id] = current + 1
        return current

    def _create_event_key(self, event_type: StreamEventType, data: dict[str, Any]) -> str:
        """Create a unique key for event deduplication."""
        key_parts = [event_type.value]
        if "tool_call_id" in data:
            key_parts.append(str(data["tool_call_id"]))
        if "content" in data:
            key_parts.append(str(hash(str(data["content"])[:100])))
        return ":".join(key_parts)

    def register_tool_call(
        self,
        session_id: str,
        call_id: str,
        tool_name: str,
        tool_input: dict[str, Any] | None = None,
    ) -> ToolCallRecord | None:
        """
        Register a new tool call in the session.

        Args:
            session_id: ID of the streaming session
            call_id: Unique ID for this tool call
            tool_name: Name of the tool being called
            tool_input: Input parameters for the tool

        Returns:
            ToolCallRecord or None if session not found
        """
        state = self._sessions.get(session_id)
        if not state:
            return None

        if state.tool_calls_in_turn >= self.config.max_tool_calls_per_turn:
            return None

        sequence = self._get_next_sequence(session_id)
        record = ToolCallRecord(
            call_id=call_id,
            tool_name=tool_name,
            tool_input=tool_input or {},
            sequence_number=sequence,
            started_at=datetime.now(),
        )

        self._tool_calls[session_id][call_id] = record
        state.tool_calls_in_turn += 1
        state.pending_tool_calls.append(call_id)
        state.last_event_time = datetime.now()

        return record

    def update_tool_input(
        self,
        session_id: str,
        call_id: str,
        tool_input: dict[str, Any],
    ) -> bool:
        """
        Update the input for a tool call.

        Args:
            session_id: ID of the streaming session
            call_id: ID of the tool call
            tool_input: Updated input parameters

        Returns:
            True if update was successful
        """
        tool_calls = self._tool_calls.get(session_id, {})
        record = tool_calls.get(call_id)

        if not record:
            return False

        record.tool_input = tool_input
        record.status = ToolCallStatus.EXECUTING
        return True

    def record_tool_observation(
        self,
        session_id: str,
        call_id: str,
        observation: str,
        is_error: bool = False,
    ) -> bool:
        """
        Record the observation/result from a tool call.

        Args:
            session_id: ID of the streaming session
            call_id: ID of the tool call
            observation: The tool's output/observation
            is_error: Whether the observation is an error

        Returns:
            True if recording was successful
        """
        state = self._sessions.get(session_id)
        tool_calls = self._tool_calls.get(session_id, {})
        record = tool_calls.get(call_id)

        if not state or not record:
            return False

        record.observation = observation
        record.completed_at = datetime.now()
        record.status = ToolCallStatus.FAILED if is_error else ToolCallStatus.COMPLETED

        if is_error:
            record.error_message = observation

        if call_id in state.pending_tool_calls:
            state.pending_tool_calls.remove(call_id)
        state.completed_tool_calls.append(call_id)
        state.last_event_time = datetime.now()

        return True

    def get_tool_call(self, session_id: str, call_id: str) -> ToolCallRecord | None:
        """Get a specific tool call record."""
        tool_calls = self._tool_calls.get(session_id, {})
        return tool_calls.get(call_id)

    def get_all_tool_calls(self, session_id: str) -> list[ToolCallRecord]:
        """Get all tool calls for a session, ordered by sequence number."""
        tool_calls = self._tool_calls.get(session_id, {})
        return sorted(tool_calls.values(), key=lambda x: x.sequence_number)

    def create_stream_event(
        self,
        session_id: str,
        event_type: StreamEventType,
        data: dict[str, Any],
        tool_call_id: str | None = None,
        is_final: bool = False,
    ) -> StreamEvent | None:
        """
        Create a new streaming event.

        Args:
            session_id: ID of the streaming session
            event_type: Type of the event
            data: Event data payload
            tool_call_id: Associated tool call ID if applicable
            is_final: Whether this is the final event

        Returns:
            StreamEvent or None if session not found or duplicate
        """
        state = self._sessions.get(session_id)
        if not state or not state.is_active:
            return None

        if self.config.deduplicate_events:
            event_key = self._create_event_key(event_type, data)
            seen = self._seen_events.get(session_id, set())
            if event_key in seen:
                return None
            seen.add(event_key)

        sequence = self._get_next_sequence(session_id)
        event = StreamEvent(
            event_type=event_type,
            sequence_number=sequence,
            data=data,
            tool_call_id=tool_call_id,
            is_final=is_final,
        )

        state.last_event_time = datetime.now()
        return event

    def buffer_chunk(self, session_id: str, chunk: StreamChunk) -> bool:
        """
        Add a chunk to the session buffer.

        Args:
            session_id: ID of the streaming session
            chunk: The chunk to buffer

        Returns:
            True if buffering was successful
        """
        buffer = self._event_buffer.get(session_id)
        if buffer is None:
            return False

        if len(buffer) >= self.config.buffer_size:
            buffer.pop(0)

        buffer.append(chunk)
        return True

    def flush_buffer(self, session_id: str) -> list[StreamChunk]:
        """
        Flush and return all buffered chunks.

        Args:
            session_id: ID of the streaming session

        Returns:
            List of buffered chunks
        """
        buffer = self._event_buffer.get(session_id, [])
        self._event_buffer[session_id] = []
        return sorted(buffer, key=lambda x: x.sequence_number)

    def generate_tool_call_events(
        self, session_id: str, call_id: str
    ) -> Generator[StreamEvent, None, None]:
        """
        Generate the sequence of events for a complete tool call.

        Args:
            session_id: ID of the streaming session
            call_id: ID of the tool call

        Yields:
            StreamEvent objects in proper order
        """
        record = self.get_tool_call(session_id, call_id)
        if not record:
            return

        start_event = self.create_stream_event(
            session_id=session_id,
            event_type=StreamEventType.TOOL_CALL_START,
            data={"tool_name": record.tool_name, "call_id": call_id},
            tool_call_id=call_id,
        )
        if start_event:
            yield start_event

        if self.config.enable_tool_input_streaming and record.tool_input:
            input_event = self.create_stream_event(
                session_id=session_id,
                event_type=StreamEventType.TOOL_CALL_DELTA,
                data={"tool_input": record.tool_input},
                tool_call_id=call_id,
            )
            if input_event:
                yield input_event

        end_event = self.create_stream_event(
            session_id=session_id,
            event_type=StreamEventType.TOOL_CALL_END,
            data={"tool_input": record.tool_input},
            tool_call_id=call_id,
        )
        if end_event:
            yield end_event

        if record.observation is not None:
            result_event = self.create_stream_event(
                session_id=session_id,
                event_type=StreamEventType.TOOL_RESULT,
                data={
                    "observation": record.observation,
                    "status": record.status.value,
                    "error": record.error_message,
                },
                tool_call_id=call_id,
            )
            if result_event:
                yield result_event

    def start_new_turn(self, session_id: str) -> bool:
        """
        Start a new conversation turn.

        Args:
            session_id: ID of the streaming session

        Returns:
            True if turn was started successfully
        """
        state = self._sessions.get(session_id)
        if not state:
            return False

        state.current_turn += 1
        state.tool_calls_in_turn = 0
        state.pending_tool_calls = []
        state.last_event_time = datetime.now()

        self._seen_events[session_id] = set()

        return True

    def get_session_statistics(self, session_id: str) -> dict[str, Any]:
        """
        Get statistics for a streaming session.

        Args:
            session_id: ID of the streaming session

        Returns:
            Dictionary of session statistics
        """
        state = self._sessions.get(session_id)
        if not state:
            return {}

        tool_calls = self._tool_calls.get(session_id, {})
        completed_calls = [tc for tc in tool_calls.values() if tc.status == ToolCallStatus.COMPLETED]
        failed_calls = [tc for tc in tool_calls.values() if tc.status == ToolCallStatus.FAILED]

        total_duration_ms = 0
        for tc in completed_calls:
            if tc.started_at and tc.completed_at:
                duration = tc.completed_at - tc.started_at
                total_duration_ms += int(duration.total_seconds() * 1000)

        return {
            "session_id": session_id,
            "is_active": state.is_active,
            "current_turn": state.current_turn,
            "total_tokens": state.total_tokens,
            "total_tool_calls": len(tool_calls),
            "completed_tool_calls": len(completed_calls),
            "failed_tool_calls": len(failed_calls),
            "pending_tool_calls": len(state.pending_tool_calls),
            "average_tool_duration_ms": total_duration_ms // len(completed_calls)
            if completed_calls
            else 0,
            "events_generated": self._sequence_counters.get(session_id, 0),
        }

    def needs_heartbeat(self, session_id: str) -> bool:
        """
        Check if a heartbeat should be sent.

        Args:
            session_id: ID of the streaming session

        Returns:
            True if heartbeat is needed
        """
        state = self._sessions.get(session_id)
        if not state or not state.is_active:
            return False

        elapsed = datetime.now() - state.last_event_time
        return elapsed.total_seconds() >= self.config.heartbeat_interval_seconds

    def create_heartbeat_event(self, session_id: str) -> StreamEvent | None:
        """Create a heartbeat event for the session."""
        return self.create_stream_event(
            session_id=session_id,
            event_type=StreamEventType.HEARTBEAT,
            data={"timestamp": datetime.now().isoformat()},
        )

    def update_token_count(self, session_id: str, tokens: int) -> bool:
        """
        Update the total token count for a session.

        Args:
            session_id: ID of the streaming session
            tokens: Number of tokens to add

        Returns:
            True if update was successful
        """
        state = self._sessions.get(session_id)
        if not state:
            return False

        state.total_tokens += tokens
        return True
