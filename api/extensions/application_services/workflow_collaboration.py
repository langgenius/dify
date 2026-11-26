"""Wire workflow collaboration to its scoped database and external access checks."""

from socketio import Server
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.rbac import RBACPermission, RBACResourceScope
from models.account import TenantAccountRole
from models.model import App, AppStatus
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository
from repositories.workflow_loro_draft_repository import read_draft_editor
from services.enterprise.rbac_service import RBACService
from services.errors.app import WorkflowNotFoundError
from services.feature_service import FeatureService
from services.workflow_collaboration_service import (
    WorkflowCollaborationForbiddenError,
    WorkflowCollaborationNotEntitledError,
    WorkflowCollaborationService,
    WorkflowDraftEditor,
)
from services.workflow_loro_document import LoroDraftSyncResult
from services.workflow_service import WorkflowService


def build_workflow_collaboration(
    database_client: sessionmaker[Session], repository: WorkflowCollaborationRepository, socketio: Server
) -> WorkflowCollaborationService:
    """Build the room owner with access checks and a separate draft transaction."""
    workflows = WorkflowService(database_client)

    def check_edit_access(editor: WorkflowDraftEditor) -> None:
        """Admit an active editor of the socket's tenant and App, then check its plan."""
        membership = read_draft_editor(
            database_client, app_id=editor.app_id, tenant_id=editor.tenant_id, account_id=editor.account_id
        )
        if membership is None:
            raise WorkflowCollaborationForbiddenError
        maintainer, role = membership
        if dify_config.RBAC_ENABLED:
            allowed = maintainer == editor.account_id or RBACService.CheckAccess.check(
                editor.tenant_id,
                editor.account_id,
                scene=RBACPermission.APP_EDIT,
                resource_type=RBACResourceScope.APP,
                resource_id=editor.app_id,
            )
        else:
            allowed = TenantAccountRole.is_editing_role(role)
        if not allowed:
            raise WorkflowCollaborationForbiddenError
        if not FeatureService.can_use_workflow_collaboration(editor.tenant_id):
            raise WorkflowCollaborationNotEntitledError

    def sync_draft(
        editor: WorkflowDraftEditor,
        *,
        epoch: str,
        version: bytes | None,
        update: bytes | None,
        allow_empty: bool,
    ) -> LoroDraftSyncResult:
        """Load an admitted App, then use a fresh transaction for the draft and its bindings."""
        with database_client() as session:
            with session:
                app = session.scalar(
                    select(App).where(
                        App.id == editor.app_id, App.tenant_id == editor.tenant_id, App.status == AppStatus.NORMAL
                    )
                )
            if app is None:
                raise WorkflowNotFoundError("Draft workflow not found.")
            return workflows.sync_loro_draft(
                app_model=app,
                account_id=editor.account_id,
                epoch=epoch,
                version=version,
                update=update,
                allow_empty=allow_empty,
                session=session,
            )

    return WorkflowCollaborationService(
        repository, socketio, check_edit_access=check_edit_access, sync_draft=sync_draft
    )
