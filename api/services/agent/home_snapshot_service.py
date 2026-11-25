"""Own immutable Agent Home Snapshot ledger rows and physical collection."""

from __future__ import annotations

import logging

from dify_agent.client import Client
from sqlalchemy import select
from sqlalchemy.orm import Session

from clients.agent_backend.factory import create_agent_backend_client
from configs import dify_config
from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from models.agent import (
    Agent,
    AgentHomeSnapshot,
    AgentStatus,
    AgentWorkingResourceStatus,
)
from repositories.agent_workspace_repository import AgentWorkspaceRepository

logger = logging.getLogger(__name__)


class AgentHomeSnapshotUnavailableError(RuntimeError):
    """The requested owner-scoped Home Snapshot cannot be used."""


class AgentHomeSnapshotService:
    """Create, retire, and collect Agent-owned immutable Home Snapshots."""

    @classmethod
    def retire_all_for_agent(cls, *, session: Session, tenant_id: str, agent_id: str) -> list[str]:
        """Stage retirement of the tenant Agent's home snapshots in the caller's transaction."""
        return AgentWorkspaceRepository(session=session).retire_home_snapshots_for_agent(
            tenant_id=tenant_id, agent_id=agent_id
        )

    @classmethod
    def retire_all_for_tenant(cls, *, session: Session, tenant_id: str) -> list[str]:
        """Retire every tenant Home Snapshot in the caller's transaction.

        Includes orphan snapshots whose Agent row is already gone. Returns all
        matched ids, including already-retired ones, so repeated collection converges.
        """
        rows = session.scalars(select(AgentHomeSnapshot).where(AgentHomeSnapshot.tenant_id == tenant_id)).all()
        now = naive_utc_now()
        for row in rows:
            if row.status == AgentWorkingResourceStatus.ACTIVE:
                row.status = AgentWorkingResourceStatus.RETIRED
                row.retired_at = now
        return [row.id for row in rows]

    @classmethod
    def collect_retired_home_snapshot(cls, *, tenant_id: str, home_snapshot_id: str) -> None:
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
            snapshot_ref = snapshot.snapshot_ref
        cls.delete(snapshot_ref=snapshot_ref)
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
        """Build the configured client for legacy collection and ledger callers."""
        return create_home_snapshot_client()


def create_home_snapshot_client() -> Client:
    """Use the configured Agent backend and its dedicated Home Snapshot timeout."""
    base_url = dify_config.AGENT_BACKEND_BASE_URL
    if not base_url:
        raise AgentHomeSnapshotUnavailableError("Dify Agent backend is required for Home Snapshot operations")
    return create_agent_backend_client(
        base_url=base_url,
        api_token=dify_config.AGENT_BACKEND_API_TOKEN,
        timeout=dify_config.AGENT_BACKEND_HOME_SNAPSHOT_TIMEOUT_SECONDS,
    )


def validate_home_snapshot_binding(*, session: Session, agent: Agent, home_snapshot_id: str | None) -> None:
    if home_snapshot_id is None:
        return
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
