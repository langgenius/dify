"""Home Snapshot retirement within the owning App or Agent transaction."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.agent import AgentHomeSnapshot, AgentWorkingResourceStatus


class AgentHomeSnapshotRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def retire_all_for_agent(self, *, tenant_id: str, agent_id: str) -> list[str]:
        """Retain all cleanup candidates, including earlier unsuccessful retirements."""
        rows = self._session.scalars(
            select(AgentHomeSnapshot).where(
                AgentHomeSnapshot.tenant_id == tenant_id,
                AgentHomeSnapshot.agent_id == agent_id,
            )
        ).all()
        now = naive_utc_now()
        for row in rows:
            if row.status == AgentWorkingResourceStatus.ACTIVE:
                row.status = AgentWorkingResourceStatus.RETIRED
                row.retired_at = now
        return [row.id for row in rows]
