"""SQLAlchemy persistence adapter for Console app MCP servers."""

import json
from typing import override

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.enums import AppStatus
from models.model import App, AppMCPServer
from repositories.app.console_visibility import console_visible_condition
from services.app.mcp_server_service import (
    AppMCPServerAlreadyExistsError,
    AppMCPServerDraft,
    AppMCPServerNotFoundError,
    AppMCPServerRecord,
    AppMCPServerStatus,
    AppMCPServerStore,
    AppMCPServerUpdate,
    PublishedApp,
)

_SERVER_CODE_LENGTH = 16


class AppMCPServerRepository(AppMCPServerStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def find_app(self, *, workspace_id: str, app_id: str) -> PublishedApp | None:
        with self._session_factory() as session:
            row = session.execute(
                select(App.name, App.description)
                .where(
                    App.id == app_id,
                    App.tenant_id == workspace_id,
                    App.status == AppStatus.NORMAL,
                    console_visible_condition(),
                )
                .limit(1)
            ).one_or_none()
        return PublishedApp(name=row.name, description=row.description or "") if row is not None else None

    @override
    def find_server(self, *, workspace_id: str, app_id: str) -> AppMCPServerRecord | None:
        with self._session_factory() as session:
            server = session.scalar(
                select(AppMCPServer)
                .where(AppMCPServer.tenant_id == workspace_id, AppMCPServer.app_id == app_id)
                .limit(1)
            )
            return self._to_record(server) if server is not None else None

    @override
    def insert_server(self, *, workspace_id: str, app_id: str, draft: AppMCPServerDraft) -> AppMCPServerRecord:
        try:
            with self._session_factory.begin() as session:
                server = AppMCPServer(
                    tenant_id=workspace_id,
                    app_id=app_id,
                    name=draft.name,
                    description=draft.description,
                    parameters=json.dumps(draft.parameters, ensure_ascii=False),
                    status=draft.status.value,
                    server_code=AppMCPServer.generate_server_code(_SERVER_CODE_LENGTH, session=session),
                )
                session.add(server)
                session.flush()
                return self._to_record(server)
        except IntegrityError as error:
            # A concurrent create can pass the caller's pre-check and win the (tenant_id, app_id) unique constraint.
            # Re-check in a fresh transaction so the committed winner is visible under any isolation level;
            # other violations (e.g. server_code) are not duplicates and must stay visible as failures.
            if self.find_server(workspace_id=workspace_id, app_id=app_id) is None:
                raise
            raise AppMCPServerAlreadyExistsError from error

    @override
    def update_server(
        self, *, workspace_id: str, app_id: str, server_id: str, update: AppMCPServerUpdate
    ) -> AppMCPServerRecord:
        with self._session_factory.begin() as session:
            server = self._require_server(session, workspace_id=workspace_id, app_id=app_id, server_id=server_id)
            server.name = update.name
            server.description = update.description
            server.parameters = json.dumps(update.parameters, ensure_ascii=False)
            if update.status is not None:
                server.status = update.status.value
            session.flush()
            return self._to_record(server)

    @override
    def rotate_server_code(self, *, workspace_id: str, app_id: str) -> AppMCPServerRecord:
        with self._session_factory.begin() as session:
            server = self._require_server(session, workspace_id=workspace_id, app_id=app_id, server_id=None)
            server.server_code = AppMCPServer.generate_server_code(_SERVER_CODE_LENGTH, session=session)
            session.flush()
            return self._to_record(server)

    @staticmethod
    def _require_server(session: Session, *, workspace_id: str, app_id: str, server_id: str | None) -> AppMCPServer:
        """Require the scoped ID, or the app's unique server when server_id is None for code rotation."""
        statement = select(AppMCPServer).where(
            AppMCPServer.tenant_id == workspace_id,
            AppMCPServer.app_id == app_id,
        )
        if server_id is not None:
            statement = statement.where(AppMCPServer.id == server_id)
        server = session.scalar(statement.limit(1))
        if server is None:
            raise AppMCPServerNotFoundError
        return server

    @staticmethod
    def _to_record(server: AppMCPServer) -> AppMCPServerRecord:
        return AppMCPServerRecord(
            id=server.id,
            name=server.name,
            server_code=server.server_code,
            description=server.description,
            status=AppMCPServerStatus(server.status),
            parameters=server.parameters,
            created_at=server.created_at,
            updated_at=server.updated_at,
        )
