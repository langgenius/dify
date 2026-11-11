"""Compatibility module re-exporting workflow pause entities.

Canonical definitions now live in ``core.app.entities.workflow_pause_state``.
"""

from core.app.entities.workflow_pause_state import (
    PauseStateConfig,
    WorkflowResumptionContext,
    _AdvancedChatAppGenerateEntityWrapper,
    _GenerateEntityUnion,
    _WorkflowGenerateEntityWrapper,
)
from core.app.entities.workflow_pause_state import (
    PauseStateConfig as PauseStateLayerConfig,
)

__all__ = [
    "PauseStateConfig",
    "PauseStateLayerConfig",
    "WorkflowResumptionContext",
    "_AdvancedChatAppGenerateEntityWrapper",
    "_GenerateEntityUnion",
    "_WorkflowGenerateEntityWrapper",
]
