"""Typed resource references for workflow ownership chains."""

from typing import NamedTuple

from models.dataset import Pipeline
from models.model import App

_WORKFLOW_OWNER_REF_CTOR_TOKEN = object()


class _WorkflowOwnerRefBase(NamedTuple):
    tenant_id: str
    owner_id: str
    ctor_token: object


class WorkflowOwnerRef(_WorkflowOwnerRefBase):
    """Tenant-scoped workflow owner reference with token-gated construction."""

    __slots__ = ()

    def __new__(cls, tenant_id: str, owner_id: str, ctor_token: object) -> "WorkflowOwnerRef":
        if ctor_token is not _WORKFLOW_OWNER_REF_CTOR_TOKEN:
            raise ValueError("WorkflowOwnerRef must be created by WorkflowRefService.")
        return super().__new__(cls, tenant_id, owner_id, ctor_token)

    def __repr__(self) -> str:
        return f"WorkflowOwnerRef(tenant_id={self.tenant_id!r}, owner_id={self.owner_id!r})"


class WorkflowRef(NamedTuple):
    """Workflow reference bound to a trusted owner reference."""

    owner: WorkflowOwnerRef
    workflow_id: str

    @property
    def tenant_id(self) -> str:
        return self.owner.tenant_id

    @property
    def app_id(self) -> str:
        return self.owner.owner_id


class WorkflowRefService:
    """Factory for trusted app and RAG pipeline workflow refs."""

    @staticmethod
    def create_app_workflow_ref(app: App, workflow_id: str) -> WorkflowRef:
        owner = WorkflowOwnerRef(app.tenant_id, app.id, _WORKFLOW_OWNER_REF_CTOR_TOKEN)
        return WorkflowRef(owner=owner, workflow_id=workflow_id)

    @staticmethod
    def create_pipeline_workflow_ref(pipeline: Pipeline, workflow_id: str) -> WorkflowRef:
        owner = WorkflowOwnerRef(pipeline.tenant_id, pipeline.id, _WORKFLOW_OWNER_REF_CTOR_TOKEN)
        return WorkflowRef(owner=owner, workflow_id=workflow_id)
