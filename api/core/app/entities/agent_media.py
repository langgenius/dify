from dataclasses import dataclass, field
from typing import Literal

MediaType = Literal["audio", "video", "image", "document", "other"]
MediaStatus = Literal["uploaded", "processing", "ready", "failed"]


@dataclass
class AgentMedia:
    """
    Represents a media object ingested by an agent.

    This entity is intentionally lightweight but extensible,
    allowing agents to reason over media references without
    embedding raw content into prompts.
    """

    file_id: str
    filename: str
    content_type: str
    size: int

    # Derived / inferred attributes
    media_type: MediaType
    status: MediaStatus = "uploaded"

    # Optional metadata
    duration: float | None = None
    metadata: dict[str, str] = field(default_factory=dict)

    # Processing results (optional, populated by downstream steps)
    transcript_file_id: str | None = None
    extracted_text_file_id: str | None = None
