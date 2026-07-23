"""Own Workspace and AgentWorkspaceBinding product lifecycle.

Dify API is the lifecycle ledger. Dify Agent only executes physical create,
acquire, and destroy operations selected by this service. Retire methods only
mutate the caller's transaction; collection performs network I/O after commit
and deletes ledger rows only after idempotent physical cleanup succeeds.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from dify_agent.client import Client
from dify_agent.protocol import CreateExecutionBindingRequest, DestroyExecutionBindingRequest
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.agent import (
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from services.agent.resource_creation_compensation import resource_creation_transaction

logger = logging.getLogger(__name__)


class AgentWorkspaceError(RuntimeError):
    pass


class AgentWorkspaceNotFoundError(AgentWorkspaceError):
    pass


class AgentWorkspaceBindingGenerationMismatchError(AgentWorkspaceError):
    pass


@dataclass(frozen=True, slots=True)
class WorkspaceOwnerScope:
    tenant_id: str
    app_id: str
    owner_type: AgentWorkspaceOwnerType
    owner_id: str
    owner_scope_key: str = "root"


class AgentWorkspaceService:
    """Resolve, allocate, retire, and collect working-environment resources."""

    @classmethod
    def resolve_active_workspace(cls, *, session: Session, scope: WorkspaceOwnerScope) -> AgentWorkspace | None:
        return session.scalar(
            select(AgentWorkspace).where(
                AgentWorkspace.tenant_id == scope.tenant_id,
                AgentWorkspace.app_id == scope.app_id,
                AgentWorkspace.owner_type == scope.owner_type,
                AgentWorkspace.owner_id == scope.owner_id,
                AgentWorkspace.owner_scope_key == scope.owner_scope_key,
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
        )

    @classmethod
    def resolve_active_binding(
        cls,
        *,
        session: Session,
        scope: WorkspaceOwnerScope,
        agent_id: str,
    ) -> AgentWorkspaceBinding | None:
        workspace = cls.resolve_active_workspace(session=session, scope=scope)
        if workspace is None:
            return None
        return session.scalar(
            select(AgentWorkspaceBinding).where(
                AgentWorkspaceBinding.tenant_id == scope.tenant_id,
                AgentWorkspaceBinding.workspace_id == workspace.id,
                AgentWorkspaceBinding.agent_id == agent_id,
                AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
            )
        )

    @classmethod
    def resolve_latest_active_conversation_binding(
        cls,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        conversation_id: str,
        agent_id: str | None,
        include_build_draft: bool,
    ) -> AgentWorkspaceBinding | None:
        """Resolve the current Binding for an Agent App conversation.

        Debug conversations may have both normal-draft ``CONVERSATION`` and
        ``BUILD_DRAFT`` Workspaces. Most recently updated Binding wins, then
        Workspace update time, Binding id, and Workspace id provide stable
        tie-breakers. Non-debug callers must keep ``include_build_draft`` false.
        """

        owner_predicate = (
            AgentWorkspace.owner_type.in_(
                (AgentWorkspaceOwnerType.CONVERSATION, AgentWorkspaceOwnerType.BUILD_DRAFT)
            )
            if include_build_draft
            else AgentWorkspace.owner_type == AgentWorkspaceOwnerType.CONVERSATION
        )
        stmt = (
            select(AgentWorkspaceBinding)
            .join(
                AgentWorkspace,
                (AgentWorkspace.tenant_id == AgentWorkspaceBinding.tenant_id)
                & (AgentWorkspace.id == AgentWorkspaceBinding.workspace_id),
            )
            .where(
                AgentWorkspace.tenant_id == tenant_id,
                AgentWorkspace.app_id == app_id,
                owner_predicate,
                AgentWorkspace.owner_id == conversation_id,
                AgentWorkspace.owner_scope_key == "root",
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
                AgentWorkspaceBinding.tenant_id == tenant_id,
                AgentWorkspaceBinding.app_id == app_id,
                AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
            )
            .order_by(
                AgentWorkspaceBinding.updated_at.desc(),
                AgentWorkspace.updated_at.desc(),
                AgentWorkspaceBinding.id.desc(),
                AgentWorkspace.id.desc(),
            )
            .limit(1)
        )
        if agent_id is not None:
            stmt = stmt.where(AgentWorkspaceBinding.agent_id == agent_id)
        return session.scalar(stmt)

    @classmethod
    def create_or_resolve_binding(
        cls,
        *,
        scope: WorkspaceOwnerScope,
        agent_id: str,
        base_home_snapshot_id: str,
        agent_config_version_id: str,
        agent_config_version_kind: AgentConfigVersionKind,
    ) -> AgentWorkspaceBinding:
        """Return the matching ACTIVE Binding or atomically allocate one.

        Physical allocation happens before rows are written. Failures before
        the transaction's final flush compensate the allocation. Once that
        flush succeeds, commit errors preserve the physical resource because
        the database outcome is unknown.
        """

        with session_factory.create_session() as session:
            with resource_creation_transaction(session) as compensations:
                existing = cls.resolve_active_binding(session=session, scope=scope, agent_id=agent_id)
                if existing is not None:
                    cls._validate_generation(
                        existing,
                        base_home_snapshot_id=base_home_snapshot_id,
                        agent_config_version_id=agent_config_version_id,
                        agent_config_version_kind=agent_config_version_kind,
                    )
                    return existing
                home_snapshot = session.scalar(
                    select(AgentHomeSnapshot).where(
                        AgentHomeSnapshot.id == base_home_snapshot_id,
                        AgentHomeSnapshot.tenant_id == scope.tenant_id,
                        AgentHomeSnapshot.agent_id == agent_id,
                        AgentHomeSnapshot.status == AgentWorkingResourceStatus.ACTIVE,
                    )
                )
                if home_snapshot is None:
                    raise AgentWorkspaceNotFoundError("base Home Snapshot is unavailable")
                workspace = cls.resolve_active_workspace(session=session, scope=scope)
                creates_workspace = workspace is None
                workspace_id = workspace.id if workspace is not None else str(uuidv7())
                binding_id = str(uuidv7())
                with cls._client() as client:
                    allocation = client.create_execution_binding_sync(
                        CreateExecutionBindingRequest(
                            tenant_id=scope.tenant_id,
                            agent_id=agent_id,
                            binding_id=binding_id,
                            workspace_id=workspace_id,
                            existing_workspace_ref=workspace.backend_workspace_ref if workspace is not None else None,
                            home_snapshot_ref=home_snapshot.snapshot_ref,
                        )
                    )
                compensations.register(
                    key=f"execution-binding:{allocation.binding_ref}",
                    compensate=lambda: cls._compensate_binding(
                        binding_ref=allocation.binding_ref,
                        workspace_ref=allocation.workspace_ref if creates_workspace else None,
                        destroy_workspace=creates_workspace,
                        scope=scope,
                    ),
                )
                if workspace is not None and allocation.workspace_ref != workspace.backend_workspace_ref:
                    raise AgentWorkspaceError("backend changed the existing Workspace ref")
                if workspace is None:
                    workspace = AgentWorkspace(
                        id=workspace_id,
                        tenant_id=scope.tenant_id,
                        app_id=scope.app_id,
                        owner_type=scope.owner_type,
                        owner_id=scope.owner_id,
                        owner_scope_key=scope.owner_scope_key,
                        backend_workspace_ref=allocation.workspace_ref,
                        status=AgentWorkingResourceStatus.ACTIVE,
                        active_guard=1,
                    )
                    session.add(workspace)
                binding = AgentWorkspaceBinding(
                    id=binding_id,
                    tenant_id=scope.tenant_id,
                    app_id=scope.app_id,
                    workspace_id=workspace_id,
                    agent_id=agent_id,
                    base_home_snapshot_id=base_home_snapshot_id,
                    agent_config_version_id=agent_config_version_id,
                    agent_config_version_kind=agent_config_version_kind,
                    backend_binding_ref=allocation.binding_ref,
                    status=AgentWorkingResourceStatus.ACTIVE,
                    active_guard=1,
                )
                session.add(binding)
            return binding

    @classmethod
    def save_binding_session_snapshot(
        cls,
        *,
        tenant_id: str,
        binding_id: str,
        session_snapshot: str,
        pending_form_id: str | None = None,
        pending_tool_call_id: str | None = None,
    ) -> None:
        with session_factory.create_session() as session:
            binding = session.scalar(
                select(AgentWorkspaceBinding).where(
                    AgentWorkspaceBinding.id == binding_id,
                    AgentWorkspaceBinding.tenant_id == tenant_id,
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                )
            )
            if binding is None:
                raise AgentWorkspaceNotFoundError("ACTIVE Binding is unavailable")
            binding.session_snapshot = session_snapshot
            binding.pending_form_id = pending_form_id
            binding.pending_tool_call_id = pending_tool_call_id
            session.commit()

    @classmethod
    def retire_binding(cls, *, session: Session, tenant_id: str, binding_id: str) -> str | None:
        binding = session.scalar(
            select(AgentWorkspaceBinding)
            .where(
                AgentWorkspaceBinding.id == binding_id,
                AgentWorkspaceBinding.tenant_id == tenant_id,
                AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
            )
            .with_for_update()
        )
        if binding is None:
            return None
        workspace = session.scalar(
            select(AgentWorkspace)
            .where(
                AgentWorkspace.id == binding.workspace_id,
                AgentWorkspace.tenant_id == tenant_id,
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
            .with_for_update()
        )
        now = naive_utc_now()
        binding.status = AgentWorkingResourceStatus.RETIRED
        binding.active_guard = None
        binding.retired_at = now
        if workspace is not None:
            other_binding = session.scalar(
                select(AgentWorkspaceBinding.id).where(
                    AgentWorkspaceBinding.tenant_id == tenant_id,
                    AgentWorkspaceBinding.workspace_id == workspace.id,
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                    AgentWorkspaceBinding.id != binding.id,
                )
            )
            if other_binding is None:
                workspace.status = AgentWorkingResourceStatus.RETIRED
                workspace.active_guard = None
                workspace.retired_at = now
        return binding.id

    @classmethod
    def retire_workspace(cls, *, session: Session, tenant_id: str, workspace_id: str) -> str | None:
        workspace = session.scalar(
            select(AgentWorkspace)
            .where(
                AgentWorkspace.id == workspace_id,
                AgentWorkspace.tenant_id == tenant_id,
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
            .with_for_update()
        )
        if workspace is None:
            return None
        now = naive_utc_now()
        workspace.status = AgentWorkingResourceStatus.RETIRED
        workspace.active_guard = None
        workspace.retired_at = now
        bindings = session.scalars(
            select(AgentWorkspaceBinding).where(
                AgentWorkspaceBinding.tenant_id == tenant_id,
                AgentWorkspaceBinding.workspace_id == workspace.id,
                AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
            )
        ).all()
        for binding in bindings:
            binding.status = AgentWorkingResourceStatus.RETIRED
            binding.active_guard = None
            binding.retired_at = now
        return workspace.id

    @classmethod
    def collect_retired_binding(cls, *, tenant_id: str, binding_id: str) -> None:
        try:
            cls._collect_retired_binding(tenant_id=tenant_id, binding_id=binding_id)
        except Exception:
            logger.exception(
                "Failed to collect retired Agent Workspace Binding",
                extra={"tenant_id": tenant_id, "binding_id": binding_id},
            )

    @classmethod
    def _collect_retired_binding(cls, *, tenant_id: str, binding_id: str) -> None:
        with session_factory.create_session() as session:
            binding = session.scalar(
                select(AgentWorkspaceBinding).where(
                    AgentWorkspaceBinding.id == binding_id,
                    AgentWorkspaceBinding.tenant_id == tenant_id,
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.RETIRED,
                )
            )
            if binding is None:
                return
            workspace = session.scalar(
                select(AgentWorkspace).where(
                    AgentWorkspace.id == binding.workspace_id,
                    AgentWorkspace.tenant_id == tenant_id,
                )
            )
            if workspace is not None and workspace.status == AgentWorkingResourceStatus.RETIRED:
                workspace_id = workspace.id
            else:
                workspace_id = None
                backend_binding_ref = binding.backend_binding_ref
        if workspace_id is not None:
            cls.collect_retired_workspace(tenant_id=tenant_id, workspace_id=workspace_id)
            return
        try:
            with cls._client() as client:
                client.destroy_execution_binding_sync(
                    DestroyExecutionBindingRequest(
                        binding_ref=backend_binding_ref,
                        destroy_workspace=False,
                    )
                )
        except Exception:
            logger.exception(
                "Failed to collect retired Agent Workspace Binding",
                extra={"tenant_id": tenant_id, "binding_id": binding_id},
            )
            return
        with session_factory.create_session() as session:
            binding = session.scalar(
                select(AgentWorkspaceBinding).where(
                    AgentWorkspaceBinding.id == binding_id,
                    AgentWorkspaceBinding.tenant_id == tenant_id,
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.RETIRED,
                )
            )
            if binding is not None:
                session.delete(binding)
                session.commit()

    @classmethod
    def collect_retired_workspace(cls, *, tenant_id: str, workspace_id: str) -> None:
        try:
            cls._collect_retired_workspace(tenant_id=tenant_id, workspace_id=workspace_id)
        except Exception:
            logger.exception(
                "Failed to collect retired Agent Workspace",
                extra={"tenant_id": tenant_id, "workspace_id": workspace_id},
            )

    @classmethod
    def _collect_retired_workspace(cls, *, tenant_id: str, workspace_id: str) -> None:
        with session_factory.create_session() as session:
            workspace = session.scalar(
                select(AgentWorkspace).where(
                    AgentWorkspace.id == workspace_id,
                    AgentWorkspace.tenant_id == tenant_id,
                    AgentWorkspace.status == AgentWorkingResourceStatus.RETIRED,
                )
            )
            if workspace is None:
                return
            bindings = session.scalars(
                select(AgentWorkspaceBinding)
                .where(
                    AgentWorkspaceBinding.tenant_id == tenant_id,
                    AgentWorkspaceBinding.workspace_id == workspace_id,
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.RETIRED,
                )
                .order_by(AgentWorkspaceBinding.created_at)
            ).all()
            if not bindings:
                logger.error(
                    "RETIRED Workspace has no Binding available for physical collection",
                    extra={"tenant_id": tenant_id, "workspace_id": workspace_id},
                )
                return
            anchor = bindings[0]
            remaining_ids = [binding.id for binding in bindings[1:]]
            workspace_ref = workspace.backend_workspace_ref
            binding_ref = anchor.backend_binding_ref
            anchor_id = anchor.id
        try:
            with cls._client() as client:
                client.destroy_execution_binding_sync(
                    DestroyExecutionBindingRequest(
                        binding_ref=binding_ref,
                        workspace_ref=workspace_ref,
                        destroy_workspace=True,
                    )
                )
        except Exception:
            logger.exception(
                "Failed to collect retired Agent Workspace",
                extra={"tenant_id": tenant_id, "workspace_id": workspace_id, "binding_id": anchor_id},
            )
            return
        with session_factory.create_session() as session:
            stored_workspace = session.scalar(
                select(AgentWorkspace).where(
                    AgentWorkspace.id == workspace_id,
                    AgentWorkspace.tenant_id == tenant_id,
                    AgentWorkspace.status == AgentWorkingResourceStatus.RETIRED,
                )
            )
            stored_anchor = session.scalar(
                select(AgentWorkspaceBinding).where(
                    AgentWorkspaceBinding.id == anchor_id,
                    AgentWorkspaceBinding.tenant_id == tenant_id,
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.RETIRED,
                )
            )
            if stored_workspace is not None:
                session.delete(stored_workspace)
            if stored_anchor is not None:
                session.delete(stored_anchor)
            session.commit()
        for remaining_id in remaining_ids:
            cls.collect_retired_binding(tenant_id=tenant_id, binding_id=remaining_id)

    @staticmethod
    def _validate_generation(
        binding: AgentWorkspaceBinding,
        *,
        base_home_snapshot_id: str,
        agent_config_version_id: str,
        agent_config_version_kind: AgentConfigVersionKind,
    ) -> None:
        if (
            binding.base_home_snapshot_id != base_home_snapshot_id
            or binding.agent_config_version_id != agent_config_version_id
            or binding.agent_config_version_kind != agent_config_version_kind
        ):
            raise AgentWorkspaceBindingGenerationMismatchError(
                "ACTIVE Binding belongs to a different Agent config/Home generation"
            )

    @staticmethod
    def _client() -> Client:
        base_url = dify_config.AGENT_BACKEND_BASE_URL
        if not base_url:
            raise AgentWorkspaceError("Dify Agent backend is required for Workspace operations")
        return Client(base_url=base_url)

    @classmethod
    def _compensate_binding(
        cls,
        *,
        binding_ref: str,
        workspace_ref: str | None,
        destroy_workspace: bool,
        scope: WorkspaceOwnerScope,
    ) -> None:
        try:
            with cls._client() as client:
                client.destroy_execution_binding_sync(
                    DestroyExecutionBindingRequest(
                        binding_ref=binding_ref,
                        workspace_ref=workspace_ref,
                        destroy_workspace=destroy_workspace,
                    )
                )
        except Exception:
            logger.exception(
                "Failed to compensate Execution Binding creation",
                extra={"tenant_id": scope.tenant_id, "binding_ref": binding_ref},
            )


__all__ = [
    "AgentWorkspaceBindingGenerationMismatchError",
    "AgentWorkspaceError",
    "AgentWorkspaceNotFoundError",
    "AgentWorkspaceService",
    "WorkspaceOwnerScope",
]
