"""SQLAlchemy read repository for network access group App projections."""

from collections.abc import Sequence
from typing import override

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from models import App
from models.agent import APP_BACKED_AGENT_SOURCES, Agent, AgentScope, AgentStatus
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
                bound_agent_id = (
                    str(binding.id)
                    if binding is not None
                    and binding.scope == AgentScope.ROSTER
                    and binding.status == AgentStatus.ACTIVE
                    else None
                )
                return self._to_record(app, bound_agent_id=bound_agent_id)
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
                apps = tuple(
                    session.scalars(
                        select(App).where(
                            App.tenant_id == workspace_id,
                            App.id.in_(app_ids),
                            App.status == "normal",
                        )
                    ).all()
                )
                if not apps:
                    return ()

                resolved_app_ids = tuple(app.id for app in apps)
                agent_bindings = session.execute(
                    select(Agent.id, Agent.app_id, Agent.backing_app_id, Agent.scope).where(
                        Agent.tenant_id == workspace_id,
                        or_(
                            and_(
                                Agent.scope == AgentScope.ROSTER,
                                Agent.status == AgentStatus.ACTIVE,
                                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                                Agent.app_id.in_(resolved_app_ids),
                            ),
                            and_(
                                Agent.scope == AgentScope.WORKFLOW_ONLY,
                                Agent.backing_app_id.in_(resolved_app_ids),
                            ),
                        ),
                    )
                ).all()
                hidden_app_ids = {
                    backing_app_id
                    for _agent_id, _app_id, backing_app_id, scope in agent_bindings
                    if scope == AgentScope.WORKFLOW_ONLY and backing_app_id is not None
                }
                bound_agent_ids = {
                    app_id: str(agent_id)
                    for agent_id, app_id, _backing_app_id, scope in agent_bindings
                    if scope == AgentScope.ROSTER and app_id is not None
                }
                return tuple(
                    self._to_record(app, bound_agent_id=bound_agent_ids.get(app.id))
                    for app in apps
                    if app.id not in hidden_app_ids
                )
        except SQLAlchemyError as exc:
            raise NetworkAccessGroupAppQueryError from exc

    @staticmethod
    def _to_record(app: App, *, bound_agent_id: str | None = None) -> NetworkAccessGroupAppRecord:
        return NetworkAccessGroupAppRecord(
            id=str(app.id),
            mode=app.mode.value,
            name=app.name,
            icon=app.icon,
            icon_type=app.icon_type.value if app.icon_type is not None else None,
            icon_background=app.icon_background,
            bound_agent_id=bound_agent_id,
        )
