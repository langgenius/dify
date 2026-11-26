"""Scoped ownership, immutable claims, receipts and authoritative native result sealing."""

import re
from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.dify_builder.models import Actor
from core.rbac import RBACPermission, RBACResourceScope
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dify_builder import (
    DifyBuilderSession,
    DifyBuilderTestInput,
)
from models.model import App
from models.workflow import Workflow
from services.dify_builder.application.execution_policy import (
    BoundedID,
    BuilderExecutionPolicyError,
)
from services.rbac.resource_queries import ResourceQueryService

_ID_ADAPTER = TypeAdapter(BoundedID)
_REASON_CODE = re.compile(r"[a-z][a-z0-9_]{0,127}\Z")


@dataclass(frozen=True)
class ExecutionOwnerSnapshot:
    app: App
    workflow: Workflow
    session: DifyBuilderSession | None
    test_input: DifyBuilderTestInput | None


def load_execution_owners(
    db: Session,
    *,
    app_id: str,
    actor: Actor,
    workflow_id: str | None = None,
    session_id: str | None = None,
    test_input_id: str | None = None,
) -> ExecutionOwnerSnapshot:
    """Read the full local owner chain in the caller's session; the shared Builder owner check."""
    account = db.get(Account, actor.account_id)
    workspace = db.get(Tenant, actor.tenant_id)
    membership = db.scalar(
        select(TenantAccountJoin).where(
            TenantAccountJoin.tenant_id == actor.tenant_id, TenantAccountJoin.account_id == actor.account_id
        )
    )
    app = db.scalar(select(App).where(App.id == app_id, App.tenant_id == actor.tenant_id, App.status == "normal"))
    if (
        account is None
        or account.status != AccountStatus.ACTIVE
        or membership is None
        or app is None
        or workspace is None
        or workspace.status != TenantStatus.NORMAL
    ):
        raise BuilderExecutionPolicyError("execution_owner_mismatch")
    if not dify_config.RBAC_ENABLED and not TenantAccountRole.is_editing_role(membership.role):
        raise BuilderExecutionPolicyError("execution_permission_denied")
    statement = select(Workflow).where(
        Workflow.app_id == app.id,
        Workflow.tenant_id == actor.tenant_id,
        Workflow.version == "draft",
        Workflow.type == "workflow",
    )
    if workflow_id is not None:
        statement = statement.where(Workflow.id == workflow_id)
    workflow = db.scalar(statement)
    if workflow is None:
        raise BuilderExecutionPolicyError("execution_owner_mismatch")
    builder_session = db.get(DifyBuilderSession, session_id) if session_id is not None else None
    test_input = db.get(DifyBuilderTestInput, test_input_id) if test_input_id is not None else None
    if session_id is not None and (
        builder_session is None
        or builder_session.app_id != app.id
        or builder_session.tenant_id != actor.tenant_id
        or builder_session.owner_account_id != actor.account_id
    ):
        raise BuilderExecutionPolicyError("execution_owner_mismatch")
    if test_input_id is not None and (test_input is None or test_input.session_id != session_id):
        raise BuilderExecutionPolicyError("execution_owner_mismatch")
    return ExecutionOwnerSnapshot(app=app, workflow=workflow, session=builder_session, test_input=test_input)


def check_execution_permission(actor: Actor, app_id: str, session_factory: sessionmaker[Session]) -> None:
    """Require edit and test/run access using the caller's database owner."""
    if not dify_config.RBAC_ENABLED:
        return
    from extensions.application_services.rbac import build_rbac_resource_queries

    check_app_permissions(
        actor,
        app_id,
        queries=build_rbac_resource_queries(database_client=session_factory),
        permissions=(RBACPermission.APP_EDIT, RBACPermission.APP_TEST_AND_RUN),
    )


def check_app_permissions(
    actor: Actor,
    app_id: str,
    *,
    queries: ResourceQueryService,
    permissions: Sequence[RBACPermission],
) -> None:
    """Require every Builder permission with native PlainApp ownership semantics.

    Resource and maintainer reads close before permission RPC. An agent-backed
    app is ineligible, and the app maintainer already owns its permissions.
    """
    if not dify_config.RBAC_ENABLED:
        return
    from services.enterprise.rbac_service import RBACService

    binding = queries.get_app_agent_binding(actor.tenant_id, app_id)
    if binding is not None:
        raise BuilderExecutionPolicyError("unsupported_workflow")
    maintainer = queries.get_app_maintainer(actor.tenant_id, app_id)
    if maintainer == actor.account_id:
        return
    try:
        for scene in permissions:
            if not RBACService.CheckAccess.check(
                actor.tenant_id, actor.account_id, scene=scene, resource_type=RBACResourceScope.APP, resource_id=app_id
            ):
                raise BuilderExecutionPolicyError("execution_permission_denied")
    except Exception:
        raise BuilderExecutionPolicyError("execution_permission_denied") from None
