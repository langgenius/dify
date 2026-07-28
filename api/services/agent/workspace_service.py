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
    """Allocate and manage working-environment resources.

    A Binding ID is the participant identity. Product callers persist that ID
    and use :meth:`get_active_binding`; Agent and Workspace attributes are not
    participant lookup keys.
    """

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
    def get_active_binding(
        cls,
        *,
        session: Session,
        tenant_id: str,
        binding_id: str,
        expected_owner_scope: WorkspaceOwnerScope,
    ) -> AgentWorkspaceBinding | None:
        return session.scalar(
            select(AgentWorkspaceBinding)
            .join(
                AgentWorkspace,
                (AgentWorkspace.tenant_id == AgentWorkspaceBinding.tenant_id)
                & (AgentWorkspace.id == AgentWorkspaceBinding.workspace_id),
            )
            .where(
                AgentWorkspaceBinding.id == binding_id,
                AgentWorkspaceBinding.tenant_id == tenant_id,
                AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                AgentWorkspace.tenant_id == expected_owner_scope.tenant_id,
                AgentWorkspace.app_id == expected_owner_scope.app_id,
                AgentWorkspace.owner_type == expected_owner_scope.owner_type,
                AgentWorkspace.owner_id == expected_owner_scope.owner_id,
                AgentWorkspace.owner_scope_key == expected_owner_scope.owner_scope_key,
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
        )

    @classmethod
    def create_binding(
        cls,
        *,
        session: Session,
        scope: WorkspaceOwnerScope,
        agent_id: str,
        base_home_snapshot_id: str,
        agent_config_version_id: str,
        agent_config_version_kind: AgentConfigVersionKind,
    ) -> AgentWorkspaceBinding:
        """Allocate one new participant in the caller-owned transaction.

        After backend creation returns successfully, any later Python, flush,
        or commit failure may leave an orphan. Dify API does not perform
        cross-system compensation; a future global reconciler is responsible
        for those orphans. Backend-local cleanup applies only when creation
        fails before the backend returns success.
        """

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
            binding.retired_at = now
        return workspace.id

    @classmethod
    def retire_all_for_app(cls, *, session: Session, tenant_id: str, app_id: str) -> list[str]:
        """Retire all ACTIVE Workspaces owned by an App in the caller's transaction."""

        workspaces = session.scalars(
            select(AgentWorkspace).where(
                AgentWorkspace.tenant_id == tenant_id,
                AgentWorkspace.app_id == app_id,
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
        ).all()
        retired: list[str] = []
        for workspace in workspaces:
            workspace_id = cls.retire_workspace(
                session=session,
                tenant_id=tenant_id,
                workspace_id=workspace.id,
            )
            if workspace_id is not None:
                retired.append(workspace_id)
        return retired

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
            backend_binding_ref = binding.backend_binding_ref
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
    def validate_binding_generation(
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


__all__ = [
    "AgentWorkspaceBindingGenerationMismatchError",
    "AgentWorkspaceError",
    "AgentWorkspaceNotFoundError",
    "AgentWorkspaceService",
    "WorkspaceOwnerScope",
]
