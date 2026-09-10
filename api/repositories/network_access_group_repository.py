"""SQLAlchemy read repository for network access group App projections."""

from collections.abc import Sequence
from typing import override

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from models import App
from models.agent import AgentScope
from services.network_access_group_service import (
    NetworkAccessGroupAppQuery,
    NetworkAccessGroupAppQueryError,
    NetworkAccessGroupAppRecord,
)


class SQLAlchemyNetworkAccessGroupAppRepository(NetworkAccessGroupAppQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_manageable_app(self, *, workspace_id: str, app_id: str) -> NetworkAccessGroupAppRecord | None:
        try:
            with self._session_factory() as session:
                app = session.scalar(
                    select(App)
                    .where(
                        App.id == app_id,
                        App.tenant_id == workspace_id,
                        App.status == "normal",
                    )
                    .limit(1)
                )
                if app is None:
                    return None
                binding = app.agent_app_binding_with_session(session=session, include_archived=True)
                if binding is not None and binding.scope == AgentScope.WORKFLOW_ONLY:
                    return None
                return self._to_record(app)
        except SQLAlchemyError as exc:
            raise NetworkAccessGroupAppQueryError from exc

    @override
    def list_apps(
        self,
        *,
        workspace_id: str,
        app_ids: Sequence[str],
    ) -> tuple[NetworkAccessGroupAppRecord, ...]:
        if not app_ids:
            return ()
        try:
            with self._session_factory() as session:
                apps = session.scalars(
                    select(App).where(
                        App.tenant_id == workspace_id,
                        App.id.in_(app_ids),
                        App.status == "normal",
                    )
                ).all()
                return tuple(self._to_record(app) for app in apps)
        except SQLAlchemyError as exc:
            raise NetworkAccessGroupAppQueryError from exc

    @staticmethod
    def _to_record(app: App) -> NetworkAccessGroupAppRecord:
        return NetworkAccessGroupAppRecord(
            id=str(app.id),
            mode=app.mode.value,
            name=app.name,
            icon=app.icon,
            icon_type=app.icon_type.value if app.icon_type is not None else None,
            icon_background=app.icon_background,
        )
