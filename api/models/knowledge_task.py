"""Durable task intents owned by the knowledge domain."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

from .base import TypeBase
from .types import StringUUID


class KnowledgeTaskOutbox(TypeBase):
    """Durable delivery and execution state for one knowledge-domain task.

    ``attempts`` counts publish claims; ``execution_attempts`` counts actual
    execution claims. ``claim_id``/``claimed_at`` identify the owner of the
    current publishing or executing phase. While executing, ``available_at`` is
    the renewable execution deadline rather than a pending delivery time.
    """

    __tablename__ = "knowledge_task_outbox"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="knowledge_task_outbox_pkey"),
        sa.Index("knowledge_task_outbox_dispatch_idx", "status", "available_at", "created_at"),
        sa.Index("knowledge_task_outbox_dataset_idx", "tenant_id", "dataset_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        insert_default=lambda: str(uuidv7()),
        default_factory=lambda: str(uuidv7()),
        init=False,
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    dataset_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    task_kind: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(sa.JSON, nullable=False)
    document_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    resource_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    execution_attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0, server_default="0")
    available_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        default_factory=naive_utc_now,
    )
    claim_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    claimed_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True, default=None)
    dispatched_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True, default=None)
    last_error: Mapped[str | None] = mapped_column(sa.Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        default_factory=naive_utc_now,
        server_default=sa.func.current_timestamp(),
        init=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        default_factory=naive_utc_now,
        server_default=sa.func.current_timestamp(),
        onupdate=sa.func.current_timestamp(),
        init=False,
    )
