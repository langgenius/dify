"""Durable handoff for one accepted draft mutation; contains no graph payload."""

from datetime import datetime

from sqlalchemy import CheckConstraint, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from models.base import TypeBase
from models.types import AdjustedJSON, StringUUID


class WorkflowDraftCoordination(TypeBase):
    __tablename__ = "workflow_draft_coordination"
    __table_args__ = (
        CheckConstraint("attempt_count >= 0", name="workflow_draft_coordination_attempt_count"),
        Index("workflow_draft_coordination_due", "available_at", "created_at", "id"),
        Index("workflow_draft_coordination_owner", "tenant_id", "app_id", "workflow_id", "workflow_version"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    app_id: Mapped[str] = mapped_column(StringUUID)
    workflow_id: Mapped[str] = mapped_column(StringUUID)
    workflow_version: Mapped[str] = mapped_column(String(255))
    account_id: Mapped[str | None] = mapped_column(StringUUID)
    retirement_agent_ids: Mapped[list[str]] = mapped_column(AdjustedJSON)
    emit_draft_event: Mapped[bool]
    available_at: Mapped[datetime] = mapped_column(default_factory=naive_utc_now)
    claim_token: Mapped[str | None] = mapped_column(StringUUID, default=None)
    attempt_count: Mapped[int] = mapped_column(default=0)
    last_error: Mapped[str | None] = mapped_column(String(255), default=None)
    created_at: Mapped[datetime] = mapped_column(default_factory=naive_utc_now)
