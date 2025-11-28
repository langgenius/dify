"""
LLM Memory Enhancement Service for Dify.

This module provides enhanced memory management capabilities for LLM nodes,
including conversation history management, context window optimization,
memory summarization, and intelligent context pruning.

Key Features:
- Conversation history management with token limits
- Automatic memory summarization for long conversations
- Context window optimization
- Memory persistence and retrieval
- Sliding window memory with importance scoring
- Memory compression strategies

Related Issue: #13738 - Enhancement of LLM Node Memory Function
"""

import hashlib
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class MemoryType(StrEnum):
    """Types of memory storage."""

    BUFFER = "buffer"
    SUMMARY = "summary"
    SLIDING_WINDOW = "sliding_window"
    TOKEN_BUFFER = "token_buffer"
    ENTITY = "entity"


class MessageRole(StrEnum):
    """Roles for conversation messages."""

    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    FUNCTION = "function"
    TOOL = "tool"


@dataclass
class MemoryMessage:
    """Represents a single message in memory."""

    role: MessageRole
    content: str
    timestamp: float = field(default_factory=time.time)
    token_count: int = 0
    importance_score: float = 1.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def __repr__(self) -> str:
        return f"MemoryMessage(role={self.role}, tokens={self.token_count})"

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "role": self.role.value,
            "content": self.content,
            "timestamp": self.timestamp,
            "token_count": self.token_count,
            "importance_score": self.importance_score,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MemoryMessage":
        """Create from dictionary."""
        return cls(
            role=MessageRole(data["role"]),
            content=data["content"],
            timestamp=data.get("timestamp", time.time()),
            token_count=data.get("token_count", 0),
            importance_score=data.get("importance_score", 1.0),
            metadata=data.get("metadata", {}),
        )


@dataclass
class MemoryState:
    """Current state of the memory system."""

    messages: list[MemoryMessage] = field(default_factory=list)
    total_tokens: int = 0
    summary: str = ""
    summary_token_count: int = 0
    last_summarized_index: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def add_message(self, message: MemoryMessage) -> None:
        """Add a message to memory."""
        self.messages.append(message)
        self.total_tokens += message.token_count

    def get_messages_as_dicts(self) -> list[dict[str, Any]]:
        """Get all messages as dictionaries."""
        return [msg.to_dict() for msg in self.messages]

    def compute_hash(self) -> str:
        """Compute hash of current state for caching."""
        content = "".join(m.content for m in self.messages)
        return hashlib.md5(content.encode()).hexdigest()


class MemoryConfig(BaseModel):
    """Configuration for memory management."""

    memory_type: MemoryType = MemoryType.BUFFER
    max_tokens: int = Field(default=4000, ge=100, le=128000)
    max_messages: int = Field(default=50, ge=1, le=1000)
    summarize_threshold: float = Field(default=0.8, ge=0.5, le=1.0)
    min_messages_to_keep: int = Field(default=4, ge=1, le=20)
    include_system_message: bool = True
    preserve_recent_count: int = Field(default=2, ge=0, le=10)
    importance_decay_rate: float = Field(default=0.95, ge=0.5, le=1.0)


class TokenCounter(ABC):
    """Abstract base class for token counting."""

    @abstractmethod
    def count(self, text: str) -> int:
        """Count tokens in text."""
        pass


class SimpleTokenCounter(TokenCounter):
    """Simple token counter based on word/character estimation."""

    def __init__(self, chars_per_token: float = 4.0):
        self.chars_per_token = chars_per_token

    def count(self, text: str) -> int:
        """Estimate token count based on character count."""
        return max(1, int(len(text) / self.chars_per_token))


class MemoryStrategy(ABC):
    """Abstract base class for memory management strategies."""

    def __init__(self, config: MemoryConfig, token_counter: TokenCounter):
        self.config = config
        self.token_counter = token_counter

    @abstractmethod
    def process(self, state: MemoryState) -> MemoryState:
        """Process memory state according to strategy."""
        pass

    @abstractmethod
    def should_trigger(self, state: MemoryState) -> bool:
        """Check if strategy should be triggered."""
        pass


class BufferMemoryStrategy(MemoryStrategy):
    """Simple buffer strategy that keeps recent messages up to token limit."""

    def should_trigger(self, state: MemoryState) -> bool:
        """Trigger when token limit is exceeded."""
        return state.total_tokens > self.config.max_tokens

    def process(self, state: MemoryState) -> MemoryState:
        """Remove oldest messages to fit within token limit."""
        if not self.should_trigger(state):
            return state

        new_messages: list[MemoryMessage] = []
        current_tokens = 0

        # Process messages from newest to oldest
        for message in reversed(state.messages):
            fits_in_budget = current_tokens + message.token_count <= self.config.max_tokens
            need_minimum = len(new_messages) < self.config.min_messages_to_keep
            if fits_in_budget or need_minimum:
                new_messages.insert(0, message)
                current_tokens += message.token_count

        state.messages = new_messages
        state.total_tokens = current_tokens
        return state


class SlidingWindowStrategy(MemoryStrategy):
    """Sliding window strategy with importance-based retention."""

    def should_trigger(self, state: MemoryState) -> bool:
        """Trigger when message count exceeds limit."""
        return len(state.messages) > self.config.max_messages

    def process(self, state: MemoryState) -> MemoryState:
        """Apply sliding window with importance scoring."""
        if not self.should_trigger(state):
            return state

        # Apply importance decay to older messages
        for i, message in enumerate(state.messages):
            age_factor = (len(state.messages) - i) / len(state.messages)
            message.importance_score *= self.config.importance_decay_rate ** age_factor

        # Sort by importance but preserve recent messages
        preserve_count = self.config.preserve_recent_count
        recent_messages = state.messages[-preserve_count:] if preserve_count > 0 else []
        older_messages = state.messages[:-preserve_count] if preserve_count > 0 else state.messages

        # Sort older messages by importance
        older_messages.sort(key=lambda m: m.importance_score, reverse=True)

        # Keep top messages up to limit
        keep_count = self.config.max_messages - len(recent_messages)
        kept_older = older_messages[:keep_count]

        # Reconstruct in chronological order
        kept_older.sort(key=lambda m: m.timestamp)
        new_messages = kept_older + recent_messages

        state.messages = new_messages
        state.total_tokens = sum(m.token_count for m in new_messages)
        return state


class SummaryMemoryStrategy(MemoryStrategy):
    """Strategy that summarizes older messages."""

    def __init__(
        self,
        config: MemoryConfig,
        token_counter: TokenCounter,
        summarizer: "MessageSummarizer | None" = None,
    ):
        super().__init__(config, token_counter)
        self.summarizer = summarizer or DefaultMessageSummarizer()

    def should_trigger(self, state: MemoryState) -> bool:
        """Trigger when tokens exceed threshold percentage of max."""
        threshold = int(self.config.max_tokens * self.config.summarize_threshold)
        return state.total_tokens > threshold

    def process(self, state: MemoryState) -> MemoryState:
        """Summarize older messages."""
        if not self.should_trigger(state):
            return state

        # Determine how many messages to summarize
        preserve_count = max(self.config.min_messages_to_keep, self.config.preserve_recent_count)
        if len(state.messages) <= preserve_count:
            return state

        messages_to_summarize = state.messages[state.last_summarized_index : -preserve_count]
        messages_to_keep = state.messages[-preserve_count:]

        if not messages_to_summarize:
            return state

        # Generate summary
        new_summary = self.summarizer.summarize(messages_to_summarize, state.summary)
        summary_tokens = self.token_counter.count(new_summary)

        # Update state
        state.summary = new_summary
        state.summary_token_count = summary_tokens
        state.messages = messages_to_keep
        state.last_summarized_index = 0
        state.total_tokens = sum(m.token_count for m in messages_to_keep) + summary_tokens

        return state


class MessageSummarizer(ABC):
    """Abstract base class for message summarization."""

    @abstractmethod
    def summarize(self, messages: list[MemoryMessage], existing_summary: str = "") -> str:
        """Summarize a list of messages."""
        pass


class DefaultMessageSummarizer(MessageSummarizer):
    """Default summarizer that creates a simple text summary."""

    def summarize(self, messages: list[MemoryMessage], existing_summary: str = "") -> str:
        """Create a simple summary of messages."""
        parts = []

        if existing_summary:
            parts.append(f"Previous context: {existing_summary}")

        for msg in messages:
            role = msg.role.value.capitalize()
            content = msg.content[:200] + "..." if len(msg.content) > 200 else msg.content
            parts.append(f"{role}: {content}")

        return " | ".join(parts)


class LLMMemoryEnhancementService:
    """
    Service for enhanced LLM memory management.

    This service provides comprehensive memory management for LLM nodes,
    including multiple memory strategies, token management, and context
    optimization.
    """

    def __init__(
        self,
        config: MemoryConfig | None = None,
        token_counter: TokenCounter | None = None,
    ):
        self.config = config or MemoryConfig()
        self.token_counter = token_counter or SimpleTokenCounter()
        self._state = MemoryState()
        self._strategy = self._create_strategy()

    def _create_strategy(self) -> MemoryStrategy:
        """Create appropriate strategy based on config."""
        if self.config.memory_type == MemoryType.BUFFER:
            return BufferMemoryStrategy(self.config, self.token_counter)
        elif self.config.memory_type == MemoryType.SLIDING_WINDOW:
            return SlidingWindowStrategy(self.config, self.token_counter)
        elif self.config.memory_type == MemoryType.SUMMARY:
            return SummaryMemoryStrategy(self.config, self.token_counter)
        else:
            return BufferMemoryStrategy(self.config, self.token_counter)

    def add_message(
        self,
        role: MessageRole | str,
        content: str,
        importance: float = 1.0,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """
        Add a message to memory.

        Args:
            role: The role of the message sender
            content: The message content
            importance: Importance score for retention priority
            metadata: Additional metadata for the message
        """
        if isinstance(role, str):
            role = MessageRole(role)

        token_count = self.token_counter.count(content)

        message = MemoryMessage(
            role=role,
            content=content,
            token_count=token_count,
            importance_score=importance,
            metadata=metadata or {},
        )

        self._state.add_message(message)

        # Apply strategy if needed
        if self._strategy.should_trigger(self._state):
            self._state = self._strategy.process(self._state)

    def get_context(self, include_summary: bool = True) -> list[dict[str, str]]:
        """
        Get the current context for LLM input.

        Args:
            include_summary: Whether to include summary as system message

        Returns:
            List of message dictionaries for LLM input
        """
        context: list[dict[str, str]] = []

        # Add summary as system context if available
        if include_summary and self._state.summary:
            context.append(
                {
                    "role": "system",
                    "content": f"Conversation summary: {self._state.summary}",
                }
            )

        # Add messages
        for message in self._state.messages:
            context.append(
                {
                    "role": message.role.value,
                    "content": message.content,
                }
            )

        return context

    def get_token_usage(self) -> dict[str, int]:
        """Get current token usage statistics."""
        return {
            "total_tokens": self._state.total_tokens,
            "summary_tokens": self._state.summary_token_count,
            "message_tokens": self._state.total_tokens - self._state.summary_token_count,
            "max_tokens": self.config.max_tokens,
            "available_tokens": max(0, self.config.max_tokens - self._state.total_tokens),
        }

    def get_message_count(self) -> int:
        """Get current message count."""
        return len(self._state.messages)

    def clear(self) -> None:
        """Clear all memory."""
        self._state = MemoryState()

    def reset_summary(self) -> None:
        """Reset the summary while keeping messages."""
        self._state.summary = ""
        self._state.summary_token_count = 0
        self._state.last_summarized_index = 0

    def export_state(self) -> dict[str, Any]:
        """Export current state for persistence."""
        return {
            "messages": self._state.get_messages_as_dicts(),
            "summary": self._state.summary,
            "summary_token_count": self._state.summary_token_count,
            "total_tokens": self._state.total_tokens,
            "last_summarized_index": self._state.last_summarized_index,
            "metadata": self._state.metadata,
            "config": self.config.model_dump(),
        }

    def import_state(self, data: dict[str, Any]) -> None:
        """Import state from persisted data."""
        self._state = MemoryState(
            messages=[MemoryMessage.from_dict(m) for m in data.get("messages", [])],
            summary=data.get("summary", ""),
            summary_token_count=data.get("summary_token_count", 0),
            total_tokens=data.get("total_tokens", 0),
            last_summarized_index=data.get("last_summarized_index", 0),
            metadata=data.get("metadata", {}),
        )

        if "config" in data:
            self.config = MemoryConfig(**data["config"])
            self._strategy = self._create_strategy()

    def optimize_for_context_window(self, target_tokens: int) -> None:
        """
        Optimize memory to fit within a target token count.

        Args:
            target_tokens: Target maximum tokens
        """
        original_max = self.config.max_tokens
        self.config.max_tokens = target_tokens
        self._strategy = self._create_strategy()

        # Force processing
        self._state = self._strategy.process(self._state)

        # Restore original config
        self.config.max_tokens = original_max

    def get_recent_messages(self, count: int) -> list[dict[str, Any]]:
        """Get the most recent messages."""
        recent = self._state.messages[-count:] if count > 0 else []
        return [msg.to_dict() for msg in recent]

    def update_message_importance(self, index: int, importance: float) -> bool:
        """Update the importance score of a message."""
        if 0 <= index < len(self._state.messages):
            self._state.messages[index].importance_score = importance
            return True
        return False

    @classmethod
    def create_with_preset(cls, preset: str) -> "LLMMemoryEnhancementService":
        """
        Create service with a preset configuration.

        Args:
            preset: One of 'minimal', 'standard', 'extended', 'unlimited'

        Returns:
            Configured service instance
        """
        presets = {
            "minimal": MemoryConfig(
                memory_type=MemoryType.BUFFER,
                max_tokens=2000,
                max_messages=10,
            ),
            "standard": MemoryConfig(
                memory_type=MemoryType.SLIDING_WINDOW,
                max_tokens=4000,
                max_messages=50,
            ),
            "extended": MemoryConfig(
                memory_type=MemoryType.SUMMARY,
                max_tokens=8000,
                max_messages=100,
                summarize_threshold=0.7,
            ),
            "unlimited": MemoryConfig(
                memory_type=MemoryType.SUMMARY,
                max_tokens=32000,
                max_messages=500,
                summarize_threshold=0.6,
            ),
        }

        config = presets.get(preset, presets["standard"])
        return cls(config=config)
