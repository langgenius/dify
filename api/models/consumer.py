"""Account-owned usage of published Apps, independent of workspace installations."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from models.base import DefaultFieldsDCMixin, TypeBase
from models.types import StringUUID


class AccountAppUsage(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "account_app_usages"
    __table_args__ = (
        sa.UniqueConstraint("account_id", "tenant_id", "app_id", name="account_app_usage_owner_key"),
        sa.Index("account_app_usage_recent_idx", "account_id", "last_used_at", "app_id"),
    )

    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False)
