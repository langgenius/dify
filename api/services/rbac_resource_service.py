from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

from extensions.ext_database import db
from models.dataset import Dataset
from models.model import App

if TYPE_CHECKING:
    from models.agent import Agent


class RBACResourceService:
    @staticmethod
    def get_app_agent_binding(tenant_id: str, app_id: str) -> Agent | None:
        app_model = db.session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
        if app_model is None:
            return None
        return app_model.agent_app_binding_with_session(session=db.session(), include_archived=True)

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
