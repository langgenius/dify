"""Durable control state for migrating a workspace's hosted credit routing.

This is not a wallet: state holds decisions, immutable plans and remote receipts,
never a locally calculated Tokener balance or consumption counter.
"""

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import TypeBase
from .types import StringUUID


class TenantModelBillingMigration(TypeBase):
    __tablename__ = "tenant_model_billing_migrations"
    __table_args__ = (
        sa.UniqueConstraint("migration_id", name="model_billing_migration_id_key"),
        sa.Index("model_billing_migration_batch_phase_idx", "batch_id", "phase", "claimed_at"),
        sa.CheckConstraint("revision >= 0 AND route_epoch >= 0", name="model_billing_migration_revision_check"),
        sa.CheckConstraint(
            "phase IN ('preparing','prepared','claimed','granting','activating','active','blocked','cancelled')",
            name="model_billing_migration_phase_check",
        ),
        sa.CheckConstraint(
            "attention IN ('normal','alerted','manual_required')",
            name="model_billing_migration_attention_check",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(
        StringUUID, sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    migration_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    batch_id: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    phase: Mapped[str] = mapped_column(sa.String(32), nullable=False, default="preparing")
    attention: Mapped[str] = mapped_column(sa.String(32), nullable=False, default="normal")
    revision: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, default=0)
    route_epoch: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, default=0)
    claimed_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    lease_token: Mapped[str | None] = mapped_column(StringUUID, default=None)
    lease_expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    state: Mapped[dict[str, Any]] = mapped_column(
        sa.JSON().with_variant(JSONB(), "postgresql"),
        nullable=False,
        default_factory=dict,
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=sa.func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=sa.func.current_timestamp(),
        onupdate=sa.func.current_timestamp(),
        init=False,
    )
