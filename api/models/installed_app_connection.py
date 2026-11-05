"""Member-specific Workspace credential choices, separate from personal Connections."""

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from .base import DefaultFieldsDCMixin, TypeBase
from .types import LongText, StringUUID


class InstalledAppConnectionConfiguration(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "installed_app_connection_configurations"
    __table_args__ = (
        sa.UniqueConstraint("installed_app_id", "account_id", "scope_id", name="installed_connection_owner_key"),
        sa.Index("installed_connection_app_idx", "tenant_id", "app_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    installed_app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    scope_id: Mapped[str] = mapped_column(sa.String(36), nullable=False)
    connection_revision: Mapped[str] = mapped_column(StringUUID, nullable=False)
    connections: Mapped[str] = mapped_column(LongText, nullable=False)
