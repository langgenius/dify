"""An Account's personal WebApp usage and collection preferences."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from models.base import DefaultFieldsDCMixin, TypeBase
from models.types import StringUUID


class AccountWebApp(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "account_webapps"
    __table_args__ = (
        sa.UniqueConstraint("account_id", "tenant_id", "app_id", name="account_webapp_owner_key"),
        sa.CheckConstraint(
            "removed_at IS NULL OR favorited_at IS NULL", name=sa.schema.conv("account_webapp_removed_favorite_check")
        ),
        sa.Index("account_webapp_recent_idx", "account_id", "removed_at", "last_used_at", "app_id"),
        sa.Index("account_webapp_favorite_idx", "account_id", "removed_at", "favorited_at", "app_id"),
        sa.Index("account_webapp_app_idx", "tenant_id", "app_id"),
    )

    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    favorited_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    removed_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
