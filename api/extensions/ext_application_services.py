"""Composition root for application services used by transport adapters."""

from dataclasses import dataclass
from typing import cast

from flask import Flask, current_app
from sqlalchemy.orm import Session, sessionmaker

from core.db.session_factory import get_session_maker
from repositories.workspace_query_repository import WorkspaceQueryRepository
from services.workspace_query_compat import LegacyWorkspacePlanGateway
from services.workspace_query_service import WorkspaceQueryService

_EXTENSION_KEY = "application_services"


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    workspace_queries: WorkspaceQueryService


def build_application_services(
    *,
    database_client: sessionmaker[Session],
) -> ApplicationServices:
    return ApplicationServices(
        workspace_queries=WorkspaceQueryService(
            workspaces=WorkspaceQueryRepository(
                client=database_client,
            ),
            plans=LegacyWorkspacePlanGateway(),
        )
    )


def init_app(app: Flask) -> None:
    app.extensions[_EXTENSION_KEY] = build_application_services(
        database_client=get_session_maker(),
    )


def application_services() -> ApplicationServices:
    """Return the application services bound to the current Flask app."""
    return cast(ApplicationServices, current_app.extensions[_EXTENSION_KEY])
