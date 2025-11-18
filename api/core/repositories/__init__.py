"""Repository implementations for data access."""

from __future__ import annotations

from importlib import import_module
from typing import Any

_ATTRIBUTE_MODULE_MAP = {
    "CeleryWorkflowExecutionRepository": "core.repositories.celery_workflow_execution_repository",
    "CeleryWorkflowNodeExecutionRepository": "core.repositories.celery_workflow_node_execution_repository",
    "DifyCoreRepositoryFactory": "core.repositories.factory",
    "RepositoryImportError": "core.repositories.factory",
    "SQLAlchemyWorkflowNodeExecutionRepository": "core.repositories.sqlalchemy_workflow_node_execution_repository",
}

__all__ = list(_ATTRIBUTE_MODULE_MAP.keys())


def __getattr__(name: str) -> Any:
    module_path = _ATTRIBUTE_MODULE_MAP.get(name)
    if module_path is None:
        raise AttributeError(f"module 'core.repositories' has no attribute '{name}'")
    module = import_module(module_path)
    return getattr(module, name)


def __dir__() -> list[str]:  # pragma: no cover - simple helper
    return sorted(__all__)
