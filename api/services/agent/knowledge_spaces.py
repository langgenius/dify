"""KnowledgeFS configuration authorization and published binding ownership.

Agent Soul references are not grants. Author validation uses current local and
enterprise permissions; published app grants remain owned by KnowledgeFS's
binding manager. Workflow grants are the union of published consumers, while
the command gateway additionally checks one Agent's immutable configuration.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.db.session_factory import session_factory
from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentSoulConfig
from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
)
from models.workflow import Workflow
from services.agent.errors import InvalidComposerConfigError
from services.agent.knowledge_datasets import list_missing_tenant_knowledge_dataset_ids
from services.knowledge_fs.product_authorization import (
    DifyKnowledgeFSProductRBACPort,
    effective_product_permissions,
    resolve_local_roles,
)
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission


def validate_agent_knowledge_spaces(
    *,
    session: Session,
    tenant_id: str,
    account_id: str,
    agent_soul: AgentSoulConfig,
) -> None:
    """Authorize selected spaces before authoring/publish, without issuing grants."""
    bindings = [binding for binding in agent_soul.knowledge.spaces if not binding.is_missing]
    if not bindings:
        return
    ids = [binding.control_space_id for binding in bindings]
    roles = read_agent_knowledge_space_roles(session, tenant_id=tenant_id, account_id=account_id, ids=ids)
    require_agent_knowledge_space_access(tenant_id=tenant_id, account_id=account_id, ids=ids, roles=roles)


def authorize_composer_knowledge(
    *,
    session_factory: sessionmaker[Session],
    tenant_id: str,
    account_id: str,
    soul: AgentSoulConfig,
    check_datasets: bool = False,
) -> None:
    """Authorize a Soul's spaces after the read session closes.

    Apply checks that Classic Knowledge datasets exist first. Draft saves allow incomplete dataset selections.
    """
    ids = [binding.control_space_id for binding in soul.knowledge.spaces if not binding.is_missing]
    if check_datasets or ids:
        with session_factory() as session:
            if check_datasets:
                missing = list_missing_tenant_knowledge_dataset_ids(
                    session=session, tenant_id=tenant_id, agent_soul=soul
                )
                if missing:
                    raise InvalidComposerConfigError(
                        "knowledge_dataset_not_found: knowledge sets reference missing or out-of-scope datasets: "
                        + ", ".join(missing)
                    )
            roles = (
                read_agent_knowledge_space_roles(session, tenant_id=tenant_id, account_id=account_id, ids=ids)
                if ids
                else {}
            )
        if ids:
            require_agent_knowledge_space_access(tenant_id=tenant_id, account_id=account_id, ids=ids, roles=roles)


def read_agent_knowledge_space_roles(
    session: Session, *, tenant_id: str, account_id: str, ids: list[str]
) -> dict[str, KnowledgeFSControlSpacePermissionRole | None]:
    """Read local roles for active spaces within the tenant, returning no ORM rows."""
    spaces = list(
        session.scalars(
            select(KnowledgeFSControlSpace).where(
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                KnowledgeFSControlSpace.id.in_(ids),
                KnowledgeFSControlSpace.state == KnowledgeFSControlSpaceState.ACTIVE,
            )
        )
    )
    return resolve_local_roles(session, control_spaces=spaces, account_id=account_id)


def require_agent_knowledge_space_access(
    *,
    tenant_id: str,
    account_id: str,
    ids: list[str],
    roles: dict[str, KnowledgeFSControlSpacePermissionRole | None],
) -> None:
    """Require local and enterprise read/query permission for every requested space."""
    permissions = DifyKnowledgeFSProductRBACPort().permission_keys_by_control_space(
        session=None,
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_ids=ids,
    )
    allowed = {
        space_id
        for space_id, role in roles.items()
        if {KnowledgeFSProductPermission.READ, KnowledgeFSProductPermission.QUERY}.issubset(
            effective_product_permissions(role, permissions.get(space_id, frozenset()))
        )
    }
    if set(ids) - allowed:
        # Missing and forbidden targets deliberately share an error.
        raise InvalidComposerConfigError(
            "knowledge_fs_space_unavailable: one or more selected Agent Knowledge Bases are unavailable or unauthorized"
        )


def sync_agent_app_knowledge_bindings(
    *,
    session: Session,
    tenant_id: str,
    account_id: str,
    agent: Agent,
    agent_soul: AgentSoulConfig,
) -> None:
    """Reconcile only the Agent channel when its published snapshot changes."""
    from services.knowledge_fs.runtime import get_knowledge_fs_runtime

    app_id = agent.backing_app_id or agent.app_id
    if not app_id:
        if agent_soul.knowledge.spaces:
            raise InvalidComposerConfigError(
                "knowledge_fs_app_required: Agent Knowledge Base access requires an app-backed Agent"
            )
        return
    ids = [binding.control_space_id for binding in agent_soul.knowledge.spaces]
    if (
        not ids
        and session.scalar(
            select(AppKnowledgeFSSpaceJoin.id)
            .where(
                AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                AppKnowledgeFSSpaceJoin.app_id == app_id,
                AppKnowledgeFSSpaceJoin.join_type == KnowledgeFSAppSpaceJoinType.AGENT,
            )
            .limit(1)
        )
        is None
    ):
        return
    get_knowledge_fs_runtime(session_factory.get_session_maker()).app_bindings.sync_agent_bindings(
        tenant_id=tenant_id,
        actor_account_id=account_id,
        app_id=app_id,
        control_space_ids=ids,
        session=session,
    )


def collect_workflow_agent_knowledge_space_ids(*, session: Session, workflow: Workflow) -> tuple[str, ...]:
    """Read frozen, tenant/app/workflow-scoped Agent snapshots, never graph-supplied Soul JSON."""
    snapshots = session.scalars(
        select(AgentConfigSnapshot)
        .join(
            WorkflowAgentNodeBinding,
            (
                (WorkflowAgentNodeBinding.tenant_id == AgentConfigSnapshot.tenant_id)
                & (WorkflowAgentNodeBinding.agent_id == AgentConfigSnapshot.agent_id)
                & (WorkflowAgentNodeBinding.current_snapshot_id == AgentConfigSnapshot.id)
            ),
        )
        .where(
            WorkflowAgentNodeBinding.tenant_id == workflow.tenant_id,
            WorkflowAgentNodeBinding.app_id == workflow.app_id,
            WorkflowAgentNodeBinding.workflow_id == workflow.id,
            WorkflowAgentNodeBinding.workflow_version == workflow.version,
        )
        .order_by(WorkflowAgentNodeBinding.node_id)
    )
    return tuple(
        dict.fromkeys(
            binding.control_space_id
            for snapshot in snapshots
            for binding in AgentSoulConfig.model_validate(snapshot.config_snapshot_dict).knowledge.spaces
        )
    )
