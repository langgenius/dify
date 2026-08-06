"""Composition root for application services used by transport adapters."""

from dataclasses import dataclass
from typing import cast

from flask import Flask, current_app
from sqlalchemy.orm import Session, sessionmaker

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.db.session_factory import get_session_maker
from repositories.workspace_member_query_repository import WorkspaceMemberQueryRepository
from repositories.workspace_query_repository import WorkspaceQueryRepository
from services.feature_query_service import FeatureQueryService
from services.feature_service import FeatureService
from services.feature_service_gateway import FeatureServiceGateway
from services.workspace_member_query_service import WorkspaceMemberQueryService
from services.workspace_member_role_resolver import DeploymentWorkspaceMemberRoleResolver
from services.workspace_plan_gateway import DeploymentWorkspacePlanGateway
from services.workspace_query_service import WorkspaceQueryService

_EXTENSION_KEY = "application_services"


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    feature_queries: FeatureQueryService
    workspace_queries: WorkspaceQueryService
    workspace_member_queries: WorkspaceMemberQueryService


def build_application_services(
    *,
    database_client: sessionmaker[Session],
) -> ApplicationServices:
    return ApplicationServices(
        feature_queries=FeatureQueryService(
            features=FeatureServiceGateway(),
            trial_models=FeatureService.get_trial_models(),
            app_dsl_version=CURRENT_APP_DSL_VERSION,
        ),
        workspace_queries=WorkspaceQueryService(
            workspaces=WorkspaceQueryRepository(
                client=database_client,
            ),
            plans=DeploymentWorkspacePlanGateway(),
        ),
        workspace_member_queries=WorkspaceMemberQueryService(
            members=WorkspaceMemberQueryRepository(
                session_factory=database_client,
            ),
            roles=DeploymentWorkspaceMemberRoleResolver(),
        ),
    )


def init_app(app: Flask) -> None:
    app.extensions[_EXTENSION_KEY] = build_application_services(
        database_client=get_session_maker(),
    )


def application_services() -> ApplicationServices:
    """Return the application services bound to the current Flask app."""
    return cast(ApplicationServices, current_app.extensions[_EXTENSION_KEY])
