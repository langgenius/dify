"""Shared app permissions for Builder draft testing."""

from collections.abc import Sequence

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.dify_builder.models import Actor
from core.rbac import RBACPermission, RBACResourceScope
from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
)
from services.rbac.resource_queries import ResourceQueryService


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
