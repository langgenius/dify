"""Framework-independent Step-by-step Tour contracts."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, TypeAlias

# Assignment-form aliases preserve Literal enum values in Pydantic-generated OpenAPI schemas.
StepByStepTourAction: TypeAlias = Literal[  # noqa: UP040
    "skip",
    "complete_task",
    "uncomplete_task",
    "enable_current_workspace",
    "disable_current_workspace",
]
StepByStepTourTaskId: TypeAlias = Literal["home", "studio", "knowledge", "integration"]  # noqa: UP040


@dataclass(frozen=True, slots=True)
class StepByStepTourPatch:
    action: StepByStepTourAction
    task_id: StepByStepTourTaskId | None = None


@dataclass(frozen=True, slots=True)
class StepByStepTourState:
    account_id: str
    first_workspace_id: str | None = None
    skipped: bool = False
    completed_task_ids: tuple[str, ...] = ()
    manually_enabled_workspace_ids: tuple[str, ...] = ()
    manually_disabled_workspace_ids: tuple[str, ...] = ()
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class StepByStepTourResult:
    first_workspace_id: str | None = None
    skipped: bool = False
    completed_task_ids: tuple[str, ...] = ()
    manually_enabled_workspace_ids: tuple[str, ...] = ()
    manually_disabled_workspace_ids: tuple[str, ...] = ()
    updated_at: datetime | None = None
