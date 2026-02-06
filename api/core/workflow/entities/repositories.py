from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from core.workflow.repositories.knowledge_repository import KnowledgeRepository

if TYPE_CHECKING:
    from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
else:  # pragma: no cover - runtime fallbacks to avoid import cycles
    WorkflowExecutionRepository = object  # type: ignore[assignment]


@dataclass
class Repositories:
    """
    Container for all repositories injected into the workflow execution context.
    Methods/Nodes can access specific repositories from this container.
    """

    knowledge_repo: KnowledgeRepository
    workflow_execution_repo: WorkflowExecutionRepository | None = None
