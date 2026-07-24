"""Own immutable Agent Home Snapshot ledger rows and physical collection."""

from __future__ import annotations

import logging

from dify_agent.client import Client, DifyAgentNotFoundError
from dify_agent.protocol import CreateHomeSnapshotFromBindingRequest, InitializeHomeSnapshotRequest
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspaceOwnerType,
)
from services.agent.errors import AgentBuildSandboxNotFoundError
from services.agent.workspace_service import AgentWorkspaceService, WorkspaceOwnerScope

logger = logging.getLogger(__name__)


class AgentHomeSnapshotUnavailableError(RuntimeError):
    """The requested owner-scoped Home Snapshot cannot be used."""


class AgentHomeSnapshotService:
    """Create, retire, and collect Agent-owned immutable Home Snapshots."""

    @classmethod
    def create_initial(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent_id: str,
    ) -> AgentHomeSnapshot:
        home_snapshot_id = str(uuidv7())
        with cls._client() as client:
            response = client.initialize_home_snapshot_sync(
                InitializeHomeSnapshotRequest(
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    home_snapshot_id=home_snapshot_id,
                )
            )
        home_snapshot = AgentHomeSnapshot(
            id=home_snapshot_id,
            tenant_id=tenant_id,
            agent_id=agent_id,
            snapshot_ref=response.snapshot_ref,
            status=AgentWorkingResourceStatus.ACTIVE,
        )
        session.add(home_snapshot)
        session.flush()
        return home_snapshot

    @classmethod
    def create_for_build_apply(
        cls,
        *,
        session: Session,
        build_draft: AgentConfigDraft,
    ) -> AgentHomeSnapshot:
        """Checkpoint the exact participant owned by ``build_draft``."""

        source_binding_id = build_draft.agent_workspace_binding_id
        if source_binding_id is None:
            raise AgentBuildSandboxNotFoundError()
        agent = session.scalar(
            select(Agent).where(
                Agent.id == build_draft.agent_id,
                Agent.tenant_id == build_draft.tenant_id,
            )
        )
        if agent is None:
            raise AgentBuildSandboxNotFoundError()
        from services.agent.roster_service import AgentRosterService

        runtime_app_id = AgentRosterService.runtime_backing_app_id(agent)
        if runtime_app_id is None:
            raise AgentBuildSandboxNotFoundError()
        binding = AgentWorkspaceService.get_active_binding(
            session=session,
            tenant_id=build_draft.tenant_id,
            binding_id=source_binding_id,
            expected_owner_scope=WorkspaceOwnerScope(
                tenant_id=build_draft.tenant_id,
                app_id=runtime_app_id,
                owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
                owner_id=build_draft.id,
            ),
        )
        if binding is None or binding.agent_id != build_draft.agent_id:
            raise AgentBuildSandboxNotFoundError()
        AgentWorkspaceService.validate_binding_generation(
            binding,
            base_home_snapshot_id=build_draft.home_snapshot_id,
            agent_config_version_id=build_draft.id,
            agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
        )

        home_snapshot_id = str(uuidv7())
        try:
            with cls._client() as client:
                response = client.create_home_snapshot_from_binding_sync(
                    CreateHomeSnapshotFromBindingRequest(
                        tenant_id=build_draft.tenant_id,
                        agent_id=build_draft.agent_id,
                        home_snapshot_id=home_snapshot_id,
                        backend_binding_ref=binding.backend_binding_ref,
                    )
                )
        except DifyAgentNotFoundError as exc:
            raise AgentBuildSandboxNotFoundError() from exc

        home_snapshot = AgentHomeSnapshot(
            id=home_snapshot_id,
            tenant_id=build_draft.tenant_id,
            agent_id=build_draft.agent_id,
            snapshot_ref=response.snapshot_ref,
            status=AgentWorkingResourceStatus.ACTIVE,
        )
        session.add(home_snapshot)
        return home_snapshot

    @classmethod
    def retire_all_for_agent(cls, *, session: Session, tenant_id: str, agent_id: str) -> list[str]:
        rows = session.scalars(
            select(AgentHomeSnapshot).where(
                AgentHomeSnapshot.tenant_id == tenant_id,
                AgentHomeSnapshot.agent_id == agent_id,
                AgentHomeSnapshot.status == AgentWorkingResourceStatus.ACTIVE,
            )
        ).all()
        now = naive_utc_now()
        for row in rows:
            row.status = AgentWorkingResourceStatus.RETIRED
            row.retired_at = now
        return [row.id for row in rows]

    @classmethod
    def collect_retired_home_snapshot(cls, *, tenant_id: str, home_snapshot_id: str) -> None:
        try:
            cls._collect_retired_home_snapshot(tenant_id=tenant_id, home_snapshot_id=home_snapshot_id)
        except Exception:
            logger.exception(
                "Failed to collect retired Agent Home Snapshot",
                extra={"tenant_id": tenant_id, "home_snapshot_id": home_snapshot_id},
            )

    @classmethod
    def _collect_retired_home_snapshot(cls, *, tenant_id: str, home_snapshot_id: str) -> None:
        with session_factory.create_session() as session:
            snapshot = session.scalar(
                select(AgentHomeSnapshot).where(
                    AgentHomeSnapshot.id == home_snapshot_id,
                    AgentHomeSnapshot.tenant_id == tenant_id,
                    AgentHomeSnapshot.status == AgentWorkingResourceStatus.RETIRED,
                )
            )
            if snapshot is None:
                return
            referenced = session.scalar(
                select(AgentConfigDraft.id).where(AgentConfigDraft.home_snapshot_id == home_snapshot_id).limit(1)
            ) or session.scalar(
                select(AgentConfigSnapshot.id).where(AgentConfigSnapshot.home_snapshot_id == home_snapshot_id).limit(1)
            )
            if referenced is not None:
                return
            snapshot_ref = snapshot.snapshot_ref
        try:
            cls.delete(snapshot_ref=snapshot_ref)
        except Exception:
            logger.exception(
                "Failed to collect retired Agent Home Snapshot",
                extra={"tenant_id": tenant_id, "home_snapshot_id": home_snapshot_id},
            )
            return
        with session_factory.create_session() as session:
            snapshot = session.scalar(
                select(AgentHomeSnapshot).where(
                    AgentHomeSnapshot.id == home_snapshot_id,
                    AgentHomeSnapshot.tenant_id == tenant_id,
                    AgentHomeSnapshot.status == AgentWorkingResourceStatus.RETIRED,
                )
            )
            if snapshot is not None:
                session.delete(snapshot)
                session.commit()

    @classmethod
    def delete(cls, *, snapshot_ref: str) -> None:
        with cls._client() as client:
            client.delete_home_snapshot_sync(snapshot_ref)

    @staticmethod
    def _client() -> Client:
        base_url = dify_config.AGENT_BACKEND_BASE_URL
        if not base_url:
            raise AgentHomeSnapshotUnavailableError("Dify Agent backend is required for Home Snapshot operations")
        return Client(base_url=base_url)


def validate_home_snapshot_binding(*, session: Session, agent: Agent, home_snapshot_id: str) -> None:
    _require_owned_home_snapshot(session=session, agent=agent, home_snapshot_id=home_snapshot_id)


def _require_owned_home_snapshot(*, session: Session, agent: Agent, home_snapshot_id: str) -> AgentHomeSnapshot:
    if agent.status != AgentStatus.ACTIVE:
        raise AgentHomeSnapshotUnavailableError(f"Agent {agent.id} is not active")
    home_snapshot = session.scalar(
        select(AgentHomeSnapshot).where(
            AgentHomeSnapshot.id == home_snapshot_id,
            AgentHomeSnapshot.tenant_id == agent.tenant_id,
            AgentHomeSnapshot.agent_id == agent.id,
            AgentHomeSnapshot.status == AgentWorkingResourceStatus.ACTIVE,
        )
    )
    if home_snapshot is None:
        raise AgentHomeSnapshotUnavailableError(f"Home Snapshot {home_snapshot_id} is unavailable for Agent {agent.id}")
    return home_snapshot


__all__ = [
    "AgentHomeSnapshotService",
    "AgentHomeSnapshotUnavailableError",
    "validate_home_snapshot_binding",
]
