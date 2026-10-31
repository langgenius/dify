"""Owner checks and encrypted snapshots for the atomic DSL import use case."""

from sqlalchemy.orm import Session, sessionmaker

from models import App, AppMode
from repositories.app.console_repository import find_normal_app
from repositories.workflow.definition_repository import WorkflowDefinitionStore, workflow_snapshot
from services.entities.dsl_entities import AppDslOverwriteTarget
from services.errors.base import NoPermissionError


class AppDslOverwriteRepository:
    def __init__(self, *, sessions: sessionmaker[Session], import_session: Session) -> None:
        self._sessions = sessions
        self._import_session = import_session

    @staticmethod
    def _find(session: Session, *, tenant_id: str, account_id: str, app_id: str, rbac_allowed: bool) -> App | None:
        app = find_normal_app(session, workspace_id=tenant_id, app_id=app_id, refresh=True)
        if app is not None and not rbac_allowed and app.maintainer != account_id:
            raise NoPermissionError("You do not have permission to overwrite this app")
        return app

    def snapshot(
        self, *, tenant_id: str, account_id: str, app_id: str, rbac_allowed: bool
    ) -> AppDslOverwriteTarget | None:
        with self._sessions() as session:
            app = self._find(
                session, tenant_id=tenant_id, account_id=account_id, app_id=app_id, rbac_allowed=rbac_allowed
            )
            if app is None:
                return None
            workflow = WorkflowDefinitionStore.get_draft_workflow(app, session=session)
            return AppDslOverwriteTarget(
                AppMode(app.mode), workflow_snapshot(workflow) if workflow is not None else None
            )

    def load(self, *, tenant_id: str, account_id: str, app_id: str, rbac_allowed: bool) -> App | None:
        return self._find(
            self._import_session,
            tenant_id=tenant_id,
            account_id=account_id,
            app_id=app_id,
            rbac_allowed=rbac_allowed,
        )
