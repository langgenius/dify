"""Load detached app-preview data without trial or account admission policy."""

from collections.abc import Sequence
from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.dataset import Dataset
from models.model import App, Site
from repositories.app_definition_query_repository import map_site_configuration
from services.app_preview_query_service import (
    AppPreviewDataset,
    AppPreviewQuery,
    AppPreviewRef,
    AppPreviewSite,
)


class AppPreviewQueryRepository(AppPreviewQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def get_app(self, *, app_id: str) -> AppPreviewRef | None:
        with self._session_factory() as session:
            row = session.execute(
                select(App.id, App.tenant_id).where(App.id == app_id, App.status == "normal")
            ).one_or_none()
            if row is None:
                return None
            return AppPreviewRef(app_id=row.id, tenant_id=row.tenant_id)

    @override
    def get_site(self, *, app: AppPreviewRef) -> AppPreviewSite | None:
        with self._session_factory() as session:
            row = session.execute(
                select(Site, Tenant.status)
                .select_from(App)
                .join(Site, Site.app_id == App.id)
                .outerjoin(Tenant, Tenant.id == App.tenant_id)
                .where(App.id == app.app_id, App.tenant_id == app.tenant_id, App.status == "normal")
                .limit(1)
            ).first()
            if row is None:
                return None
            site, owner_status = row
            return AppPreviewSite(
                configuration=map_site_configuration(site),
                owner_status=owner_status.value if owner_status is not None else None,
            )

    @override
    def get_datasets(self, *, app: AppPreviewRef, ids: Sequence[str]) -> tuple[AppPreviewDataset, ...] | None:
        with self._session_factory() as session:
            app_id = session.scalar(
                select(App.id).where(App.id == app.app_id, App.tenant_id == app.tenant_id, App.status == "normal")
            )
            if app_id is None:
                return None
            if not ids:
                return ()
            datasets = session.scalars(select(Dataset).where(Dataset.id.in_(ids), Dataset.tenant_id == app.tenant_id))
            return tuple(
                AppPreviewDataset(
                    id=dataset.id,
                    name=dataset.name,
                    description=dataset.description,
                    permission=dataset.permission.value if dataset.permission is not None else None,
                    data_source_type=dataset.data_source_type.value if dataset.data_source_type is not None else None,
                    indexing_technique=dataset.indexing_technique.value
                    if dataset.indexing_technique is not None
                    else None,
                    created_by=dataset.created_by,
                    created_at=dataset.created_at,
                )
                for dataset in datasets
            )
