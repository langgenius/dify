"""Own Agent Home Snapshot identities and backend lifecycle boundaries.

Dify API persists the append-only ``AgentHomeSnapshot`` ledger. Dify Agent is
only a stateless physical executor: initialization creates a backend-native
Home, Build Apply snapshots one exact retained Sandbox, and Agent retirement
deletes every recorded backend ref without rewriting ledger rows.
"""

from __future__ import annotations

import logging

from dify_agent.client import Client, DifyAgentNotFoundError
from dify_agent.protocol import (
    CreateHomeSnapshotFromSandboxRequest,
    InitializeHomeSnapshotRequest,
    SandboxLocator,
)
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from configs import dify_config
from libs.uuid_utils import uuidv7
from models.agent import Agent, AgentConfigDraft, AgentHomeSnapshot, AgentStatus
from services.agent.errors import AgentBuildSandboxNotFoundError

logger = logging.getLogger(__name__)


class AgentHomeSnapshotUnavailableError(RuntimeError):
    """The requested owner-scoped Home resource cannot be used."""


class AgentHomeSnapshotSourceError(RuntimeError):
    """Build Apply has no exact retained Sandbox source to snapshot."""


class AgentHomeSnapshotService:
    """Coordinate product-owned immutable Home resources with Dify Agent."""

    @classmethod
    def create_initial(cls, *, session: Session, tenant_id: str, agent_id: str) -> AgentHomeSnapshot:
        """Create and persist one backend-native initial Home for a new Agent."""
        home_snapshot_id = str(uuidv7())
        snapshot_ref: str | None = None
        try:
            with cls._client() as client:
                response = client.initialize_home_snapshot_sync(
                    InitializeHomeSnapshotRequest(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                        home_snapshot_id=home_snapshot_id,
                    )
                )
            snapshot_ref = response.snapshot_ref
            home_snapshot = AgentHomeSnapshot(
                id=home_snapshot_id,
                tenant_id=tenant_id,
                agent_id=agent_id,
                snapshot_ref=snapshot_ref,
            )
            session.add(home_snapshot)
            session.flush()
            cls._register_initial_compensation(
                session=session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                home_snapshot_id=home_snapshot_id,
                snapshot_ref=snapshot_ref,
            )
            return home_snapshot
        except Exception:
            if snapshot_ref is not None:
                cls._compensate_delete(
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    home_snapshot_id=home_snapshot_id,
                    snapshot_ref=snapshot_ref,
                )
            raise

    @classmethod
    def create_for_build_apply(
        cls,
        *,
        session: Session,
        build_draft: AgentConfigDraft,
        source_sandbox: SandboxLocator,
    ) -> AgentHomeSnapshot:
        """Snapshot one exact retained Build Sandbox and persist its Home row."""
        home_snapshot_id = str(uuidv7())
        snapshot_ref: str | None = None
        try:
            with cls._client() as client:
                response = client.create_home_snapshot_from_sandbox_sync(
                    CreateHomeSnapshotFromSandboxRequest(
                        tenant_id=build_draft.tenant_id,
                        agent_id=build_draft.agent_id,
                        home_snapshot_id=home_snapshot_id,
                        source_sandbox=source_sandbox,
                    )
                )
            snapshot_ref = response.snapshot_ref
            home_snapshot = AgentHomeSnapshot(
                id=home_snapshot_id,
                tenant_id=build_draft.tenant_id,
                agent_id=build_draft.agent_id,
                snapshot_ref=snapshot_ref,
            )
            session.add(home_snapshot)
            session.flush()
            return home_snapshot
        except DifyAgentNotFoundError as exc:
            raise AgentBuildSandboxNotFoundError() from exc
        except Exception:
            if snapshot_ref is not None:
                cls._compensate_delete(
                    tenant_id=build_draft.tenant_id,
                    agent_id=build_draft.agent_id,
                    home_snapshot_id=home_snapshot_id,
                    snapshot_ref=snapshot_ref,
                )
            raise

    @classmethod
    def delete_all_for_agent(cls, *, session: Session, tenant_id: str, agent_id: str) -> None:
        """Idempotently delete every physical Home recorded for an Agent."""
        snapshots = session.scalars(
            select(AgentHomeSnapshot).where(
                AgentHomeSnapshot.tenant_id == tenant_id,
                AgentHomeSnapshot.agent_id == agent_id,
            )
        ).all()
        for snapshot in snapshots:
            try:
                cls.delete(snapshot_ref=snapshot.snapshot_ref)
            except Exception:
                logger.exception(
                    "Failed to retire Agent Home Snapshot: tenant_id=%s agent_id=%s home_snapshot_id=%s "
                    "snapshot_ref=%s",
                    tenant_id,
                    agent_id,
                    snapshot.id,
                    snapshot.snapshot_ref,
                )
                raise

    @classmethod
    def delete(cls, *, snapshot_ref: str) -> None:
        """Delete one physical Home ref without changing the immutable ledger."""
        with cls._client() as client:
            client.delete_home_snapshot_sync(snapshot_ref)

    @staticmethod
    def _client() -> Client:
        base_url = dify_config.AGENT_BACKEND_BASE_URL
        if not base_url:
            raise AgentHomeSnapshotUnavailableError("Dify Agent backend is required for Home Snapshot operations.")
        return Client(base_url=base_url)

    @classmethod
    def _compensate_delete(
        cls,
        *,
        tenant_id: str,
        agent_id: str,
        home_snapshot_id: str,
        snapshot_ref: str,
    ) -> None:
        try:
            cls.delete(snapshot_ref=snapshot_ref)
        except Exception:
            logger.exception(
                "Failed to compensate Home Snapshot creation",
                extra={
                    "tenant_id": tenant_id,
                    "agent_id": agent_id,
                    "home_snapshot_id": home_snapshot_id,
                    "snapshot_ref": snapshot_ref,
                },
            )

    @classmethod
    def _register_initial_compensation(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent_id: str,
        home_snapshot_id: str,
        snapshot_ref: str,
    ) -> None:
        """Delete an initialized physical Home if its provisioning transaction rolls back."""
        state = {"committed": False, "compensated": False}

        def mark_committed(_session: Session) -> None:
            state["committed"] = True

        def compensate_after_rollback(_session: Session) -> None:
            if state["committed"] or state["compensated"]:
                return
            state["compensated"] = True
            cls._compensate_delete(
                tenant_id=tenant_id,
                agent_id=agent_id,
                home_snapshot_id=home_snapshot_id,
                snapshot_ref=snapshot_ref,
            )

        event.listen(session, "after_commit", mark_committed, once=True)
        event.listen(session, "after_rollback", compensate_after_rollback, once=True)


def validate_home_snapshot_binding(
    *,
    session: Session,
    agent: Agent,
    home_snapshot_id: str,
) -> None:
    """Fail fast unless an ACTIVE Agent owns the requested logical Home."""
    _require_owned_home_snapshot(session=session, agent=agent, home_snapshot_id=home_snapshot_id)


def require_runtime_home_snapshot_ref(
    *,
    session: Session,
    agent: Agent,
    home_snapshot_id: str,
) -> str:
    """Resolve one ACTIVE Agent's owner-scoped Home at the runtime boundary."""
    home_snapshot = _require_owned_home_snapshot(
        session=session,
        agent=agent,
        home_snapshot_id=home_snapshot_id,
    )
    return home_snapshot.snapshot_ref


def _require_owned_home_snapshot(
    *,
    session: Session,
    agent: Agent,
    home_snapshot_id: str,
) -> AgentHomeSnapshot:
    if agent.status != AgentStatus.ACTIVE:
        raise AgentHomeSnapshotUnavailableError(f"Agent {agent.id} is not active.")
    home_snapshot = session.scalar(
        select(AgentHomeSnapshot).where(
            AgentHomeSnapshot.id == home_snapshot_id,
            AgentHomeSnapshot.tenant_id == agent.tenant_id,
            AgentHomeSnapshot.agent_id == agent.id,
        )
    )
    if home_snapshot is None:
        raise AgentHomeSnapshotUnavailableError(
            f"Home Snapshot {home_snapshot_id} is unavailable for Agent {agent.id}."
        )
    return home_snapshot


__all__ = [
    "AgentHomeSnapshotService",
    "AgentHomeSnapshotSourceError",
    "AgentHomeSnapshotUnavailableError",
    "require_runtime_home_snapshot_ref",
    "validate_home_snapshot_binding",
]
