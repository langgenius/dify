"""Validated internal payloads for persisted workflow node retry history."""

from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

RETRY_HISTORY_PROCESS_DATA_KEY = "__dify_retry_history"


class WorkflowNodeRetryAttempt(BaseModel):
    """Complete data captured for one failed node attempt before a retry."""

    retry_index: int = Field(gt=0)
    inputs: Mapping[str, Any]
    process_data: Mapping[str, Any]
    outputs: Mapping[str, Any]
    error: str
    elapsed_time: float = Field(ge=0)
    execution_metadata: Mapping[str, Any]
    created_at: int
    finished_at: int

    model_config = ConfigDict(extra="forbid")
