from __future__ import annotations

from sqlalchemy import select

from extensions.ext_database import db
from models.agent import Agent, AgentStatus
from models.dataset import Dataset
from models.model import App


class RBACResourceService:
    @staticmethod
    def get_agent_creator(tenant_id: str, agent_id: str) -> str | None:
        """Return an active Agent's creator in this tenant, or None if absent or unset."""
        return db.session.scalar(
            select(Agent.created_by).where(
                Agent.id == agent_id,
                Agent.tenant_id == tenant_id,
                Agent.status == AgentStatus.ACTIVE,
            )
        )

    @staticmethod
    def get_app_agent_binding(tenant_id: str, app_id: str) -> Agent | None:
        app_model = db.session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
        if app_model is None:
            return None
        return app_model.agent_app_binding_with_session(session=db.session, include_archived=True)

    @staticmethod
    def get_app_maintainer(tenant_id: str, app_id: str) -> str | None:
        return db.session.scalar(
            select(App.maintainer).where(App.id == app_id, App.tenant_id == tenant_id, App.status == "normal")
        )

    @staticmethod
    def get_dataset_maintainer(tenant_id: str, dataset_id: str) -> str | None:
        return db.session.scalar(
            select(Dataset.maintainer).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id)
        )

    @staticmethod
    def get_dataset_id_by_pipeline(tenant_id: str, pipeline_id: str) -> str | None:
        dataset_id = db.session.scalar(
            select(Dataset.id).where(Dataset.pipeline_id == pipeline_id, Dataset.tenant_id == tenant_id)
        )
        return None if dataset_id is None else str(dataset_id)
