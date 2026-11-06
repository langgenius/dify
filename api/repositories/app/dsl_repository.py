"""Owner checks and encrypted snapshots for the atomic DSL import use case."""

from sqlalchemy.orm import Session, sessionmaker

from models import AppMode
from repositories.app.console_repository import find_normal_app
from repositories.workflow.definition_repository import WorkflowDefinitionStore, workflow_snapshot
from services.entities.dsl_entities import AppDslOverwriteTarget
from services.errors.base import NoPermissionError


class AppDslOverwriteRepository:
    """Materialize overwrite records without exposing mapped state or ending the import transaction."""

    def __init__(self, *, sessions: sessionmaker[Session], import_session: Session) -> None:
        self._sessions = sessions
        self._import_session = import_session

    @staticmethod
    def _load_target(
        session: Session, *, tenant_id: str, account_id: str, app_id: str, rbac_allowed: bool
    ) -> AppDslOverwriteTarget | None:
        """Authorize within the given session and return encrypted values without ending its transaction.

        The RBAC verdict must be resolved before calling. Missing/non-normal Apps return None;
        an existing App requires RBAC access or maintainership, otherwise NoPermissionError is raised.
        """
        app = find_normal_app(session, workspace_id=tenant_id, app_id=app_id, refresh=True)
        if app is not None and not rbac_allowed and app.maintainer != account_id:
            raise NoPermissionError("You do not have permission to overwrite this app")
        if app is None:
            return None
        workflow = WorkflowDefinitionStore.get_draft_workflow(app, session=session)
        return AppDslOverwriteTarget(AppMode(app.mode), workflow_snapshot(workflow) if workflow is not None else None)

    def snapshot(
        self, *, tenant_id: str, account_id: str, app_id: str, rbac_allowed: bool
    ) -> AppDslOverwriteTarget | None:
        """Return authorized encrypted values in a separate read session, closed before returning.

        Use the supplied RBAC verdict; preserve the enclosing import session and the load error contract.
        """
        with self._sessions() as session:
            return self._load_target(
                session, tenant_id=tenant_id, account_id=account_id, app_id=app_id, rbac_allowed=rbac_allowed
            )

    def load(self, *, tenant_id: str, account_id: str, app_id: str, rbac_allowed: bool) -> AppDslOverwriteTarget | None:
        """Reauthorize and materialize encrypted values in the caller-owned import transaction.

        Honor the same scope and errors as snapshot; leave commit and rollback to the import owner.
        """
        return self._load_target(
            self._import_session,
            tenant_id=tenant_id,
            account_id=account_id,
            app_id=app_id,
            rbac_allowed=rbac_allowed,
        )
