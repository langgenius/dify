from typing import Any

from pydantic import BaseModel


class WorkflowRunPayload(BaseModel):
    inputs: dict[str, Any]
    files: list[dict[str, Any]] | None = None
