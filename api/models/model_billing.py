from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import TypeBase
from .types import StringUUID


class TenantModelBillingProfile(TypeBase):
    """Persisted tenant cohort for managed-model billing and routing."""

    __tablename__ = "tenant_model_billing_profiles"
    __table_args__ = (
        sa.PrimaryKeyConstraint("tenant_id", name="tenant_model_billing_profile_pkey"),
        sa.CheckConstraint(
            "model_billing_source IS NULL OR model_billing_source = 'tokener'",
            name="tenant_model_billing_profile_source_check",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(
        StringUUID,
        sa.ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    # NULL intentionally means the pre-Tokener legacy message-credit path.
    # Keep this as a string so the resolver can fail closed on future/invalid values.
    model_billing_source: Mapped[str | None] = mapped_column(String(40), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        init=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )
