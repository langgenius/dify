"""Streaming event types for workflow generation progress."""

import json
from typing import Literal

from pydantic import BaseModel, Field

# Stage constants
STAGE_PLANNING = "planning"
STAGE_BUILDING = "building"
STAGE_VALIDATING = "validating"

# Stage messages (English)
STAGE_MESSAGES_EN = {
    STAGE_PLANNING: "Analyzing requirements...",
    STAGE_BUILDING: "Generating workflow...",
    STAGE_VALIDATING: "Validating...",
}

# Stage messages (Chinese)
STAGE_MESSAGES_ZH = {
    STAGE_PLANNING: "正在分析需求...",
    STAGE_BUILDING: "正在生成工作流...",
    STAGE_VALIDATING: "正在验证...",
}

# Type alias for stage values
StageType = Literal["planning", "building", "validating"]


class StageEvent(BaseModel):
    """A stage progress event during workflow generation."""

    stage: StageType = Field(description="Current stage: planning, building, or validating")
    message: str = Field(description="Human-readable status message")


def get_stage_message(stage: str, language: str | None = None) -> str:
    """Get the localized message for a stage.

    Args:
        stage: Stage constant (STAGE_PLANNING, STAGE_BUILDING, STAGE_VALIDATING)
        language: Optional language code (e.g., "en", "zh-Hans")

    Returns:
        Localized message for the stage
    """
    if language and language.startswith("zh"):
        return STAGE_MESSAGES_ZH.get(stage, stage)
    return STAGE_MESSAGES_EN.get(stage, stage)


def format_sse_event(event_type: str, data: dict[str, object]) -> str:
    """Format data as an SSE event string.

    Args:
        event_type: Event type (stage, complete, error)
        data: Event data payload

    Returns:
        SSE-formatted string: 'data: {"event": "...", ...}\n\n'
    """
    payload = {"event": event_type, **data}
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
