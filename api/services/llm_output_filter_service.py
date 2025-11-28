"""
LLM Output Filter Service for Dify.

This module provides streaming output filtering capabilities for LLM nodes,
allowing real-time content moderation, format transformation, and output
sanitization during streaming responses.

Key Features:
- Real-time streaming content filtering
- Pattern-based content replacement
- Sensitive data masking
- Format normalization
- Token-level processing
- Configurable filter chains

Related Issue: #14270 - Streaming Output Filter for LLM Nodes
"""

import re
from abc import ABC, abstractmethod
from collections.abc import Generator, Iterator
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class FilterAction(StrEnum):
    """Actions that can be taken by a filter."""

    PASS = "pass"
    MODIFY = "modify"
    BLOCK = "block"
    BUFFER = "buffer"


class FilterPriority(StrEnum):
    """Priority levels for filter execution order."""

    HIGHEST = "highest"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"
    LOWEST = "lowest"


@dataclass
class FilterResult:
    """Result of applying a filter to content."""

    action: FilterAction
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)
    should_continue: bool = True

    def __repr__(self) -> str:
        return f"FilterResult(action={self.action}, content_len={len(self.content)})"


@dataclass
class StreamChunk:
    """Represents a chunk of streaming content."""

    content: str
    index: int
    is_final: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def __repr__(self) -> str:
        return f"StreamChunk(index={self.index}, len={len(self.content)}, final={self.is_final})"


class ContentFilter(ABC):
    """Abstract base class for content filters."""

    def __init__(self, name: str, priority: FilterPriority = FilterPriority.NORMAL):
        self.name = name
        self.priority = priority
        self.enabled = True

    @abstractmethod
    def apply(self, chunk: StreamChunk) -> FilterResult:
        """Apply the filter to a stream chunk."""
        pass

    def reset(self) -> None:
        """Reset filter state for a new stream."""
        self.enabled = True  # Reset to default enabled state


class PatternFilter(ContentFilter):
    """Filter that matches and replaces patterns in content."""

    def __init__(
        self,
        name: str,
        patterns: list[tuple[str, str]],
        priority: FilterPriority = FilterPriority.NORMAL,
        case_sensitive: bool = False,
    ):
        super().__init__(name, priority)
        self.patterns = patterns
        self.case_sensitive = case_sensitive
        self._compiled_patterns: list[tuple[re.Pattern, str]] = []
        self._compile_patterns()

    def _compile_patterns(self) -> None:
        """Compile regex patterns for efficiency."""
        flags = 0 if self.case_sensitive else re.IGNORECASE
        self._compiled_patterns = [
            (re.compile(pattern, flags), replacement) for pattern, replacement in self.patterns
        ]

    def apply(self, chunk: StreamChunk) -> FilterResult:
        """Apply pattern replacements to the chunk."""
        content = chunk.content
        modified = False

        for pattern, replacement in self._compiled_patterns:
            new_content = pattern.sub(replacement, content)
            if new_content != content:
                modified = True
                content = new_content

        return FilterResult(
            action=FilterAction.MODIFY if modified else FilterAction.PASS,
            content=content,
            metadata={"patterns_applied": modified},
        )


class SensitiveDataFilter(ContentFilter):
    """Filter for masking sensitive data like emails, phone numbers, etc."""

    # Common patterns for sensitive data
    PATTERNS = {
        "email": (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", "[EMAIL]"),
        "phone": (r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b", "[PHONE]"),
        "ssn": (r"\b\d{3}-\d{2}-\d{4}\b", "[SSN]"),
        "credit_card": (r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b", "[CARD]"),
        "ip_address": (r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "[IP]"),
        "api_key": (r"\b(sk-|pk-|api[-_]?key[-_]?)[a-zA-Z0-9]{20,}\b", "[API_KEY]"),
    }

    def __init__(
        self,
        name: str = "sensitive_data_filter",
        enabled_patterns: list[str] | None = None,
        priority: FilterPriority = FilterPriority.HIGH,
    ):
        super().__init__(name, priority)
        self.enabled_patterns = enabled_patterns or list(self.PATTERNS.keys())
        self._compiled: list[tuple[re.Pattern, str]] = []
        self._compile()

    def _compile(self) -> None:
        """Compile enabled patterns."""
        for pattern_name in self.enabled_patterns:
            if pattern_name in self.PATTERNS:
                pattern, replacement = self.PATTERNS[pattern_name]
                self._compiled.append((re.compile(pattern), replacement))

    def apply(self, chunk: StreamChunk) -> FilterResult:
        """Mask sensitive data in the chunk."""
        content = chunk.content
        masked_count = 0

        for pattern, replacement in self._compiled:
            matches = pattern.findall(content)
            if matches:
                masked_count += len(matches)
                content = pattern.sub(replacement, content)

        return FilterResult(
            action=FilterAction.MODIFY if masked_count > 0 else FilterAction.PASS,
            content=content,
            metadata={"masked_count": masked_count},
        )


class ProfanityFilter(ContentFilter):
    """Filter for blocking or replacing profane content."""

    def __init__(
        self,
        name: str = "profanity_filter",
        word_list: list[str] | None = None,
        replacement: str = "***",
        priority: FilterPriority = FilterPriority.HIGH,
    ):
        super().__init__(name, priority)
        self.word_list = word_list or []
        self.replacement = replacement
        self._pattern: re.Pattern | None = None
        if self.word_list:
            self._compile()

    def _compile(self) -> None:
        """Compile word list into regex pattern."""
        escaped_words = [re.escape(word) for word in self.word_list]
        pattern_str = r"\b(" + "|".join(escaped_words) + r")\b"
        self._pattern = re.compile(pattern_str, re.IGNORECASE)

    def apply(self, chunk: StreamChunk) -> FilterResult:
        """Replace profane words in the chunk."""
        if not self._pattern:
            return FilterResult(action=FilterAction.PASS, content=chunk.content)

        content = chunk.content
        matches = self._pattern.findall(content)

        if matches:
            content = self._pattern.sub(self.replacement, content)
            return FilterResult(
                action=FilterAction.MODIFY,
                content=content,
                metadata={"words_filtered": len(matches)},
            )

        return FilterResult(action=FilterAction.PASS, content=chunk.content)


class LengthLimitFilter(ContentFilter):
    """Filter that enforces maximum content length."""

    def __init__(
        self,
        name: str = "length_limit_filter",
        max_length: int = 10000,
        truncation_suffix: str = "...[truncated]",
        priority: FilterPriority = FilterPriority.LOW,
    ):
        super().__init__(name, priority)
        self.max_length = max_length
        self.truncation_suffix = truncation_suffix
        self._total_length = 0

    def apply(self, chunk: StreamChunk) -> FilterResult:
        """Enforce length limit on streaming content."""
        remaining = self.max_length - self._total_length

        if remaining <= 0:
            return FilterResult(
                action=FilterAction.BLOCK,
                content="",
                metadata={"reason": "max_length_exceeded"},
                should_continue=False,
            )

        if len(chunk.content) <= remaining:
            self._total_length += len(chunk.content)
            return FilterResult(action=FilterAction.PASS, content=chunk.content)

        # Truncate content
        truncated = chunk.content[:remaining] + self.truncation_suffix
        self._total_length = self.max_length
        return FilterResult(
            action=FilterAction.MODIFY,
            content=truncated,
            metadata={"truncated": True},
            should_continue=False,
        )

    def reset(self) -> None:
        """Reset length counter for new stream."""
        self._total_length = 0


class FormatNormalizerFilter(ContentFilter):
    """Filter for normalizing output format."""

    def __init__(
        self,
        name: str = "format_normalizer",
        normalize_whitespace: bool = True,
        normalize_newlines: bool = True,
        trim_trailing: bool = True,
        priority: FilterPriority = FilterPriority.LOWEST,
    ):
        super().__init__(name, priority)
        self.normalize_whitespace = normalize_whitespace
        self.normalize_newlines = normalize_newlines
        self.trim_trailing = trim_trailing

    def apply(self, chunk: StreamChunk) -> FilterResult:
        """Normalize format of the chunk."""
        content = chunk.content
        modified = False

        if self.normalize_whitespace:
            new_content = re.sub(r"[ \t]+", " ", content)
            if new_content != content:
                modified = True
                content = new_content

        if self.normalize_newlines:
            new_content = re.sub(r"\n{3,}", "\n\n", content)
            if new_content != content:
                modified = True
                content = new_content

        if self.trim_trailing and chunk.is_final:
            new_content = content.rstrip()
            if new_content != content:
                modified = True
                content = new_content

        return FilterResult(
            action=FilterAction.MODIFY if modified else FilterAction.PASS,
            content=content,
        )


class FilterChainConfig(BaseModel):
    """Configuration for a filter chain."""

    name: str
    enabled: bool = True
    filters: list[dict[str, Any]] = Field(default_factory=list)
    stop_on_block: bool = True


class LLMOutputFilterService:
    """
    Service for filtering LLM streaming output.

    This service manages filter chains and applies them to streaming
    content from LLM nodes.
    """

    # Priority order for filter execution
    PRIORITY_ORDER = [
        FilterPriority.HIGHEST,
        FilterPriority.HIGH,
        FilterPriority.NORMAL,
        FilterPriority.LOW,
        FilterPriority.LOWEST,
    ]

    def __init__(self):
        self._filters: list[ContentFilter] = []
        self._buffer: str = ""

    def add_filter(self, filter_instance: ContentFilter) -> None:
        """Add a filter to the chain."""
        self._filters.append(filter_instance)
        self._sort_filters()

    def remove_filter(self, filter_name: str) -> bool:
        """Remove a filter by name."""
        initial_count = len(self._filters)
        self._filters = [f for f in self._filters if f.name != filter_name]
        return len(self._filters) < initial_count

    def _sort_filters(self) -> None:
        """Sort filters by priority."""
        priority_map = {p: i for i, p in enumerate(self.PRIORITY_ORDER)}
        self._filters.sort(key=lambda f: priority_map.get(f.priority, 2))

    def reset(self) -> None:
        """Reset all filters for a new stream."""
        self._buffer = ""
        for f in self._filters:
            f.reset()

    def process_chunk(self, content: str, index: int, is_final: bool = False) -> FilterResult:
        """
        Process a single chunk through all filters.

        Args:
            content: The content to filter
            index: The chunk index in the stream
            is_final: Whether this is the final chunk

        Returns:
            FilterResult with the processed content
        """
        current_content = content
        combined_metadata: dict[str, Any] = {}
        final_action = FilterAction.PASS

        for filter_instance in self._filters:
            if not filter_instance.enabled:
                continue

            result = filter_instance.apply(
                StreamChunk(content=current_content, index=index, is_final=is_final)
            )

            combined_metadata[filter_instance.name] = result.metadata
            current_content = result.content

            if result.action == FilterAction.BLOCK:
                return FilterResult(
                    action=FilterAction.BLOCK,
                    content="",
                    metadata=combined_metadata,
                    should_continue=False,
                )

            if result.action == FilterAction.MODIFY:
                final_action = FilterAction.MODIFY

            if not result.should_continue:
                break

        return FilterResult(
            action=final_action,
            content=current_content,
            metadata=combined_metadata,
        )

    def process_stream(
        self,
        stream: Iterator[str],
    ) -> Generator[str, None, None]:
        """
        Process a stream of content through all filters.

        Args:
            stream: Iterator yielding content chunks

        Yields:
            Filtered content chunks
        """
        self.reset()
        index = 0

        chunks = list(stream)
        total = len(chunks)

        for i, content in enumerate(chunks):
            is_final = i == total - 1
            result = self.process_chunk(content, index, is_final)

            if result.action == FilterAction.BLOCK:
                break

            if result.content:
                yield result.content

            if not result.should_continue:
                break

            index += 1

    @classmethod
    def create_default_chain(cls) -> "LLMOutputFilterService":
        """Create a filter service with default filters."""
        service = cls()
        service.add_filter(SensitiveDataFilter())
        service.add_filter(FormatNormalizerFilter())
        return service

    @classmethod
    def create_from_config(cls, config: FilterChainConfig) -> "LLMOutputFilterService":
        """Create a filter service from configuration."""
        service = cls()

        if not config.enabled:
            return service

        for filter_config in config.filters:
            filter_type = filter_config.get("type", "")
            filter_name = filter_config.get("name") or filter_type

            if filter_type == "pattern":
                patterns = filter_config.get("patterns", [])
                service.add_filter(PatternFilter(name=filter_name, patterns=patterns))

            elif filter_type == "sensitive_data":
                enabled_patterns = filter_config.get("enabled_patterns")
                service.add_filter(
                    SensitiveDataFilter(name=filter_name, enabled_patterns=enabled_patterns)
                )

            elif filter_type == "profanity":
                word_list = filter_config.get("word_list", [])
                replacement = filter_config.get("replacement", "***")
                service.add_filter(
                    ProfanityFilter(name=filter_name, word_list=word_list, replacement=replacement)
                )

            elif filter_type == "length_limit":
                max_length = filter_config.get("max_length", 10000)
                service.add_filter(LengthLimitFilter(name=filter_name, max_length=max_length))

            elif filter_type == "format_normalizer":
                service.add_filter(FormatNormalizerFilter(name=filter_name))

        return service

    def get_filter_stats(self) -> dict[str, Any]:
        """Get statistics about the filter chain."""
        return {
            "filter_count": len(self._filters),
            "filters": [
                {
                    "name": f.name,
                    "priority": f.priority.value,
                    "enabled": f.enabled,
                    "type": type(f).__name__,
                }
                for f in self._filters
            ],
        }
