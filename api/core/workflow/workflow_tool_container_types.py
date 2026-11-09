from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class WorkflowToolContainerPayload(BaseModel):
    """Serializable inputs needed to execute one Workflow Tool child graph."""

    model_config = ConfigDict(frozen=True)

    version: Literal["1"] = "1"
    source_app_id: str
    source_workflow_id: str
    source_workflow_version: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    system_files: list[dict[str, Any]] = Field(default_factory=list)
    inputs_for_log: dict[str, Any] = Field(default_factory=dict)
    call_depth: int = Field(ge=0)
