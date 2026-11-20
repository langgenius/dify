"""Persistence port shared by Workflow Tool metadata and execution adapters."""

from dataclasses import dataclass
from typing import Protocol

from core.tools.entities.tool_entities import WorkflowToolParameterConfiguration
from models import Account, EndUser, Workflow
from models.model import App
from models.tools import WorkflowToolProvider


@dataclass(frozen=True)
class WorkflowToolDefinition:
    id: str
    tenant_id: str
    user_id: str
    app_id: str
    name: str
    label: str
    icon: str
    description: str
    version: str
    privacy_policy: str
    parameter_configurations: list[WorkflowToolParameterConfiguration]


class WorkflowToolQueries(Protocol):
    def provider(self, *, tenant_id: str, provider_id: str) -> WorkflowToolProvider | None: ...
    def provider_for_app(self, *, tenant_id: str, app_id: str) -> WorkflowToolProvider | None: ...
    def providers(self, *, tenant_id: str) -> list[WorkflowToolProvider]: ...
    def app(self, *, tenant_id: str, app_id: str) -> App: ...
    def workflow(self, *, tenant_id: str, app_id: str, version: str) -> Workflow: ...
    def current_workflow(self, *, tenant_id: str, app_id: str) -> Workflow: ...
    def labels(self, *, tenant_id: str, provider_ids: list[str]) -> dict[str, list[str]]: ...
    def actor(self, *, tenant_id: str, user_id: str) -> Account | EndUser | None: ...


class WorkflowToolStore(WorkflowToolQueries, Protocol):
    def save(self, provider: WorkflowToolDefinition, *, labels: list[str] | None, create: bool) -> None: ...
    def delete(self, *, tenant_id: str, provider_id: str) -> None: ...
