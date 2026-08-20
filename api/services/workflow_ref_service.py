"""Typed resource references for workflow ownership chains."""

from typing import NamedTuple

from models.dataset import Pipeline
from models.model import App
from models.snippet import CustomizedSnippet


class WorkflowRef(NamedTuple):
    """Workflow identifiers used to scope downstream resource lookups."""

    tenant_id: str
    owner_id: str
    workflow_id: str


class WorkflowRefService:
    """Factory helpers for app and RAG pipeline workflow refs."""

    @staticmethod
    def create_app_workflow_ref(app: App, workflow_id: str) -> WorkflowRef:
        return WorkflowRef(tenant_id=app.tenant_id, owner_id=app.id, workflow_id=workflow_id)

    @staticmethod
    def create_pipeline_workflow_ref(pipeline: Pipeline, workflow_id: str) -> WorkflowRef:
        return WorkflowRef(tenant_id=pipeline.tenant_id, owner_id=pipeline.id, workflow_id=workflow_id)

    @staticmethod
    def create_snippet_workflow_ref(snippet: CustomizedSnippet, workflow_id: str) -> WorkflowRef:
        return WorkflowRef(tenant_id=snippet.tenant_id, owner_id=snippet.id, workflow_id=workflow_id)
