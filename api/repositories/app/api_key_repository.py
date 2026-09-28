"""App API keys with tenant scoping and repository-owned transactions."""

from typing import override

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from core.agent.publish_visibility import workflow_callable_active_snapshot_filter
from models.agent import APP_BACKED_AGENT_SOURCES, Agent, AgentScope, AgentStatus
from models.enums import ApiTokenType, AppStatus
from models.model import ApiToken, App, AppMode
from services.app.api_key_service import AppApiKeyAccessState, AppApiKeyStore
from services.auth.api_key_contracts import (
    ApiKeyLimitExceededError,
    ApiKeyNotFoundError,
    ApiKeyRecord,
    ApiKeyResourceNotFoundError,
)


class AppApiKeyRepository(AppApiKeyStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def resolve_agent_app_id(self, workspace_id: str, agent_id: str) -> str:
        with self._session_factory() as session:
            app_id = session.scalar(
                select(App.id)
                .join(Agent, Agent.app_id == App.id)
                .where(
                    App.tenant_id == workspace_id,
                    App.mode == AppMode.AGENT,
                    App.status == AppStatus.NORMAL,
                    Agent.tenant_id == workspace_id,
                    Agent.id == agent_id,
                    Agent.scope == AgentScope.ROSTER,
                    Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                    Agent.status == AgentStatus.ACTIVE,
                )
            )
            if app_id is None:
                raise ApiKeyResourceNotFoundError("Agent not found.")
            return app_id

    @override
    def get_access_state(self, workspace_id: str, app_id: str) -> AppApiKeyAccessState:
        with self._session_factory() as session:
            app = self._get_app(session, workspace_id, app_id)
            if app.mode != AppMode.AGENT:
                return AppApiKeyAccessState(is_agent_app=False, has_published_snapshot=False)
            published = session.scalar(
                select(Agent.id)
                .where(
                    Agent.tenant_id == workspace_id,
                    Agent.app_id == app_id,
                    Agent.scope == AgentScope.ROSTER,
                    Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                    Agent.status == AgentStatus.ACTIVE,
                    workflow_callable_active_snapshot_filter(),
                )
                .limit(1)
            )
            return AppApiKeyAccessState(is_agent_app=True, has_published_snapshot=published is not None)

    @override
    def list_keys(self, workspace_id: str, app_id: str) -> tuple[ApiKeyRecord, ...]:
        with self._session_factory() as session:
            self._get_app(session, workspace_id, app_id)
            return tuple(self._record(key) for key in session.scalars(self._key_query(workspace_id, app_id)))

    @override
    def create_key(self, workspace_id: str, app_id: str, *, max_keys: int, prefix: str) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            # Serialize count-and-insert for the App, including historical keys.
            self._get_app(session, workspace_id, app_id, for_update=True)
            count = session.scalar(select(func.count()).select_from(self._key_query(workspace_id, app_id).subquery()))
            if count is not None and count >= max_keys:
                raise ApiKeyLimitExceededError(max_keys)
            key = ApiToken(
                tenant_id=workspace_id,
                app_id=app_id,
                type=ApiTokenType.APP,
                token=ApiToken.generate_api_key(prefix, 24, session=session),
            )
            session.add(key)
            session.flush()
            return self._record(key)

    @override
    def delete_key(self, workspace_id: str, app_id: str, key_id: str) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            self._get_app(session, workspace_id, app_id)
            key = session.scalar(self._key_query(workspace_id, app_id).where(ApiToken.id == key_id))
            if key is None:
                raise ApiKeyNotFoundError
            record = self._record(key)
            session.delete(key)
            return record

    @staticmethod
    def _get_app(session: Session, workspace_id: str, app_id: str, *, for_update: bool = False) -> App:
        query = select(App).where(App.id == app_id, App.tenant_id == workspace_id)
        if for_update:
            query = query.with_for_update()
        app = session.scalar(query)
        if app is None:
            raise ApiKeyResourceNotFoundError("App not found.")
        return app

    @staticmethod
    def _key_query(workspace_id: str, app_id: str) -> Select[tuple[ApiToken]]:
        # Historical keys have no tenant_id; the owning App is validated first.
        return select(ApiToken).where(
            or_(ApiToken.tenant_id == workspace_id, ApiToken.tenant_id.is_(None)),
            ApiToken.type == ApiTokenType.APP,
            ApiToken.app_id == app_id,
        )

    @staticmethod
    def _record(key: ApiToken) -> ApiKeyRecord:
        return ApiKeyRecord(
            id=key.id, type=key.type, token=key.token, last_used_at=key.last_used_at, created_at=key.created_at
        )
