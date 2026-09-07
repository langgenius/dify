"""Persist workspace installations with independently scoped operations."""

from datetime import datetime
from typing import cast, override

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from models.model import App, InstalledApp
from services.installed_app_access_service import InstalledAppAccessStore, InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_generation_service import InstalledAppUsageRecorder


class SQLAlchemyInstalledAppRepository(InstalledAppAccessStore, InstalledAppUsageRecorder):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

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

    @override
    def record(self, *, installed_app: InstalledAppRef, used_at: datetime) -> None:
        """Commit usage independently so generation failures do not roll it back."""
        with self._session_factory.begin() as session:
            result = session.execute(
                update(InstalledApp)
                .where(
                    InstalledApp.id == installed_app.id,
                    InstalledApp.tenant_id == installed_app.tenant_id,
                    InstalledApp.app_id == installed_app.app_id,
                )
                .values(last_used_at=used_at)
            )
            if cast(CursorResult, result).rowcount == 0:
                raise InstalledAppNotFoundError(f"Installed app {installed_app.id} no longer exists")
