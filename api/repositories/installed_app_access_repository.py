"""Resolve workspace installations before external access checks."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.model import App, InstalledApp
from services.installed_app_access_service import InstalledAppAccessStore, InstalledAppRef


class SQLAlchemyInstalledAppAccessRepository(InstalledAppAccessStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def resolve(self, *, installed_app_id: str, tenant_id: str) -> InstalledAppRef | None:
        with self._session_factory() as session:
            installed_app = session.scalar(
                select(InstalledApp)
                .where(InstalledApp.id == installed_app_id, InstalledApp.tenant_id == tenant_id)
                .limit(1)
            )
            if installed_app is None:
                return None

            # An installed public app can belong to another workspace. Admission
            # preserves the existence check; publication policy belongs to its callers.
            app_id = session.scalar(select(App.id).where(App.id == installed_app.app_id).limit(1))
            if app_id is None:
                session.delete(installed_app)
                session.commit()
                return None

            return InstalledAppRef(id=installed_app.id, app_id=app_id, tenant_id=installed_app.tenant_id)
