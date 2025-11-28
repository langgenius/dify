"""
Document Chunking Service for Dify.

This module provides utilities for managing document chunking configurations,
displaying chunk details, and ensuring consistency between API uploads and
the user interface.

Related Issue: #16486 - API uploaded documents don't show right chunking details
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ChunkingMode(StrEnum):
    """Available chunking modes."""

    AUTOMATIC = "automatic"
    CUSTOM = "custom"
    HIERARCHICAL = "hierarchical"
    SEMANTIC = "semantic"


class SeparatorType(StrEnum):
    """Types of text separators."""

    PARAGRAPH = "paragraph"
    SENTENCE = "sentence"
    LINE = "line"
    CUSTOM = "custom"
    REGEX = "regex"


@dataclass
class ChunkMetadata:
    """Metadata for a single chunk."""

    chunk_id: str
    document_id: str
    chunk_index: int
    start_position: int
    end_position: int
    token_count: int
    character_count: int
    created_at: datetime = field(default_factory=datetime.now)
    separator_used: str | None = None
    overlap_with_previous: int = 0
    overlap_with_next: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ChunkingResult:
    """Result of a chunking operation."""

    document_id: str
    total_chunks: int
    total_characters: int
    total_tokens: int
    average_chunk_size: float
    min_chunk_size: int
    max_chunk_size: int
    chunks: list[ChunkMetadata] = field(default_factory=list)
    processing_time_ms: int = 0
    warnings: list[str] = field(default_factory=list)


class ChunkingConfig(BaseModel):
    """Configuration for document chunking."""

    mode: ChunkingMode = ChunkingMode.AUTOMATIC
    chunk_size: int = Field(default=500, ge=100, le=4000)
    chunk_overlap: int = Field(default=50, ge=0, le=500)
    separator_type: SeparatorType = SeparatorType.PARAGRAPH
    custom_separators: list[str] = Field(default_factory=list)
    regex_pattern: str | None = None
    preserve_sentences: bool = Field(default=True)
    remove_extra_whitespace: bool = Field(default=True)
    min_chunk_size: int = Field(default=100, ge=10, le=1000)
    max_chunk_size: int = Field(default=2000, ge=500, le=8000)


class DocumentChunkingDetails(BaseModel):
    """Details about document chunking for display."""

    document_id: str
    document_name: str
    chunking_mode: ChunkingMode
    chunk_size: int
    chunk_overlap: int
    separator_type: SeparatorType
    custom_separators: list[str] = Field(default_factory=list)
    total_chunks: int = 0
    average_chunk_tokens: float = 0.0
    indexing_status: str = "pending"
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class ChunkPreview(BaseModel):
    """Preview of a chunk for UI display."""

    chunk_index: int
    content_preview: str
    token_count: int
    character_count: int
    start_position: int
    end_position: int
    separator_info: str | None = None


class DocumentChunkingService:
    """
    Service for managing document chunking configurations and display.

    Provides functionality for:
    - Storing and retrieving chunking configurations
    - Generating chunk previews for UI display
    - Validating chunking parameters
    - Synchronizing API and UI chunking details
    """

    DEFAULT_SEPARATORS: dict[SeparatorType, list[str]] = {
        SeparatorType.PARAGRAPH: ["\n\n", "\r\n\r\n"],
        SeparatorType.SENTENCE: [".", "!", "?", "。", "！", "？"],
        SeparatorType.LINE: ["\n", "\r\n", "\r"],
        SeparatorType.CUSTOM: [],
        SeparatorType.REGEX: [],
    }

    def __init__(self) -> None:
        """Initialize the document chunking service."""
        self._configs: dict[str, ChunkingConfig] = {}
        self._details: dict[str, DocumentChunkingDetails] = {}
        self._chunk_cache: dict[str, list[ChunkMetadata]] = {}

    def store_config(
        self,
        document_id: str,
        config: ChunkingConfig,
        document_name: str = "",
    ) -> DocumentChunkingDetails:
        """
        Store chunking configuration for a document.

        Args:
            document_id: ID of the document
            config: Chunking configuration
            document_name: Name of the document

        Returns:
            DocumentChunkingDetails for the stored configuration
        """
        self._configs[document_id] = config

        details = DocumentChunkingDetails(
            document_id=document_id,
            document_name=document_name,
            chunking_mode=config.mode,
            chunk_size=config.chunk_size,
            chunk_overlap=config.chunk_overlap,
            separator_type=config.separator_type,
            custom_separators=config.custom_separators,
        )
        self._details[document_id] = details

        return details

    def get_config(self, document_id: str) -> ChunkingConfig | None:
        """Get chunking configuration for a document."""
        return self._configs.get(document_id)

    def get_details(self, document_id: str) -> DocumentChunkingDetails | None:
        """Get chunking details for UI display."""
        return self._details.get(document_id)

    def update_chunk_statistics(
        self,
        document_id: str,
        total_chunks: int,
        average_tokens: float,
        indexing_status: str = "completed",
    ) -> bool:
        """
        Update chunk statistics after processing.

        Args:
            document_id: ID of the document
            total_chunks: Total number of chunks created
            average_tokens: Average tokens per chunk
            indexing_status: Current indexing status

        Returns:
            True if update was successful
        """
        details = self._details.get(document_id)
        if not details:
            return False

        details.total_chunks = total_chunks
        details.average_chunk_tokens = average_tokens
        details.indexing_status = indexing_status
        details.updated_at = datetime.now()

        return True

    def validate_config(self, config: ChunkingConfig) -> tuple[bool, list[str]]:
        """
        Validate a chunking configuration.

        Args:
            config: Configuration to validate

        Returns:
            Tuple of (is_valid, list of error messages)
        """
        errors: list[str] = []

        if config.chunk_overlap >= config.chunk_size:
            errors.append("Chunk overlap must be less than chunk size")

        if config.min_chunk_size >= config.max_chunk_size:
            errors.append("Minimum chunk size must be less than maximum")

        if config.chunk_size < config.min_chunk_size:
            errors.append("Chunk size cannot be less than minimum chunk size")

        if config.chunk_size > config.max_chunk_size:
            errors.append("Chunk size cannot exceed maximum chunk size")

        if config.separator_type == SeparatorType.CUSTOM and not config.custom_separators:
            errors.append("Custom separators required when using custom separator type")

        if config.separator_type == SeparatorType.REGEX and not config.regex_pattern:
            errors.append("Regex pattern required when using regex separator type")

        return len(errors) == 0, errors

    def get_effective_separators(self, config: ChunkingConfig) -> list[str]:
        """
        Get the effective separators for a configuration.

        Args:
            config: Chunking configuration

        Returns:
            List of separator strings to use
        """
        if config.separator_type == SeparatorType.CUSTOM:
            return config.custom_separators

        return self.DEFAULT_SEPARATORS.get(config.separator_type, [])

    def calculate_chunk_boundaries(
        self,
        text: str,
        config: ChunkingConfig,
    ) -> list[tuple[int, int]]:
        """
        Calculate chunk boundaries for a text.

        Args:
            text: The text to chunk
            config: Chunking configuration

        Returns:
            List of (start, end) position tuples
        """
        if not text:
            return []

        boundaries: list[tuple[int, int]] = []
        text_length = len(text)
        current_pos = 0

        while current_pos < text_length:
            chunk_end = min(current_pos + config.chunk_size, text_length)

            if chunk_end < text_length and config.preserve_sentences:
                separators = self.get_effective_separators(config)
                best_break = chunk_end

                for sep in separators:
                    last_sep = text.rfind(sep, current_pos, chunk_end)
                    if last_sep > current_pos + config.min_chunk_size:
                        best_break = last_sep + len(sep)
                        break

                chunk_end = best_break

            boundaries.append((current_pos, chunk_end))

            next_start = chunk_end - config.chunk_overlap
            current_pos = max(next_start, chunk_end)

            if current_pos >= text_length:
                break

        return boundaries

    def generate_chunk_previews(
        self,
        document_id: str,
        text: str,
        max_previews: int = 5,
        preview_length: int = 200,
    ) -> list[ChunkPreview]:
        """
        Generate chunk previews for UI display.

        Args:
            document_id: ID of the document
            text: Full document text
            max_previews: Maximum number of previews to generate
            preview_length: Maximum length of preview content

        Returns:
            List of ChunkPreview objects
        """
        config = self._configs.get(document_id)
        if not config:
            config = ChunkingConfig()

        boundaries = self.calculate_chunk_boundaries(text, config)
        previews: list[ChunkPreview] = []

        for idx, (start, end) in enumerate(boundaries[:max_previews]):
            chunk_text = text[start:end]
            preview_text = chunk_text[:preview_length]
            if len(chunk_text) > preview_length:
                preview_text += "..."

            separators = self.get_effective_separators(config)
            separator_info = None
            for sep in separators:
                if sep in chunk_text:
                    separator_info = f"Contains '{repr(sep)}'"
                    break

            preview = ChunkPreview(
                chunk_index=idx,
                content_preview=preview_text,
                token_count=len(chunk_text.split()),
                character_count=len(chunk_text),
                start_position=start,
                end_position=end,
                separator_info=separator_info,
            )
            previews.append(preview)

        return previews

    def estimate_chunk_count(self, text_length: int, config: ChunkingConfig) -> int:
        """
        Estimate the number of chunks for a given text length.

        Args:
            text_length: Length of the text in characters
            config: Chunking configuration

        Returns:
            Estimated number of chunks
        """
        if text_length <= 0:
            return 0

        effective_chunk_size = config.chunk_size - config.chunk_overlap
        if effective_chunk_size <= 0:
            effective_chunk_size = config.chunk_size

        return max(1, (text_length + effective_chunk_size - 1) // effective_chunk_size)

    def format_config_for_display(self, document_id: str) -> dict[str, Any]:
        """
        Format chunking configuration for API/UI display.

        Args:
            document_id: ID of the document

        Returns:
            Dictionary with formatted configuration details
        """
        config = self._configs.get(document_id)
        details = self._details.get(document_id)

        if not config:
            return {"error": "Configuration not found"}

        separators = self.get_effective_separators(config)
        separator_display = ", ".join([repr(s) for s in separators[:3]])
        if len(separators) > 3:
            separator_display += f" (+{len(separators) - 3} more)"

        result: dict[str, Any] = {
            "chunking_mode": config.mode.value,
            "chunk_size": config.chunk_size,
            "chunk_overlap": config.chunk_overlap,
            "separator_type": config.separator_type.value,
            "separators": separator_display,
            "preserve_sentences": config.preserve_sentences,
            "min_chunk_size": config.min_chunk_size,
            "max_chunk_size": config.max_chunk_size,
        }

        if details:
            result.update(
                {
                    "total_chunks": details.total_chunks,
                    "average_chunk_tokens": round(details.average_chunk_tokens, 2),
                    "indexing_status": details.indexing_status,
                    "last_updated": details.updated_at.isoformat(),
                }
            )

        return result

    def sync_api_config_to_ui(
        self,
        document_id: str,
        api_config: dict[str, Any],
        document_name: str = "",
    ) -> DocumentChunkingDetails:
        """
        Synchronize API-provided configuration to UI display format.

        Args:
            document_id: ID of the document
            api_config: Configuration from API request
            document_name: Name of the document

        Returns:
            DocumentChunkingDetails for UI display
        """
        mode = ChunkingMode(api_config.get("mode", "automatic"))
        separator_type = SeparatorType(api_config.get("separator_type", "paragraph"))

        config = ChunkingConfig(
            mode=mode,
            chunk_size=api_config.get("chunk_size", 500),
            chunk_overlap=api_config.get("chunk_overlap", 50),
            separator_type=separator_type,
            custom_separators=api_config.get("custom_separators", []),
            regex_pattern=api_config.get("regex_pattern"),
            preserve_sentences=api_config.get("preserve_sentences", True),
            remove_extra_whitespace=api_config.get("remove_extra_whitespace", True),
            min_chunk_size=api_config.get("min_chunk_size", 100),
            max_chunk_size=api_config.get("max_chunk_size", 2000),
        )

        return self.store_config(document_id, config, document_name)

    def get_chunking_summary(self, document_id: str) -> dict[str, Any]:
        """
        Get a summary of chunking for a document.

        Args:
            document_id: ID of the document

        Returns:
            Summary dictionary
        """
        details = self._details.get(document_id)
        config = self._configs.get(document_id)

        if not details or not config:
            return {"document_id": document_id, "status": "not_configured"}

        return {
            "document_id": document_id,
            "document_name": details.document_name,
            "status": details.indexing_status,
            "chunking": {
                "mode": config.mode.value,
                "chunk_size": config.chunk_size,
                "overlap": config.chunk_overlap,
                "separator": config.separator_type.value,
            },
            "statistics": {
                "total_chunks": details.total_chunks,
                "avg_tokens": round(details.average_chunk_tokens, 2),
            },
            "timestamps": {
                "created": details.created_at.isoformat(),
                "updated": details.updated_at.isoformat(),
            },
        }

    def compare_configs(
        self,
        config1: ChunkingConfig,
        config2: ChunkingConfig,
    ) -> dict[str, Any]:
        """
        Compare two chunking configurations.

        Args:
            config1: First configuration
            config2: Second configuration

        Returns:
            Dictionary of differences
        """
        differences: dict[str, Any] = {}

        if config1.mode != config2.mode:
            differences["mode"] = {"from": config1.mode.value, "to": config2.mode.value}

        if config1.chunk_size != config2.chunk_size:
            differences["chunk_size"] = {"from": config1.chunk_size, "to": config2.chunk_size}

        if config1.chunk_overlap != config2.chunk_overlap:
            differences["chunk_overlap"] = {
                "from": config1.chunk_overlap,
                "to": config2.chunk_overlap,
            }

        if config1.separator_type != config2.separator_type:
            differences["separator_type"] = {
                "from": config1.separator_type.value,
                "to": config2.separator_type.value,
            }

        if set(config1.custom_separators) != set(config2.custom_separators):
            differences["custom_separators"] = {
                "from": config1.custom_separators,
                "to": config2.custom_separators,
            }

        return differences

    def delete_config(self, document_id: str) -> bool:
        """
        Delete chunking configuration for a document.

        Args:
            document_id: ID of the document

        Returns:
            True if deletion was successful
        """
        deleted = False

        if document_id in self._configs:
            del self._configs[document_id]
            deleted = True

        if document_id in self._details:
            del self._details[document_id]
            deleted = True

        if document_id in self._chunk_cache:
            del self._chunk_cache[document_id]

        return deleted
