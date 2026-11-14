"""Durable capacity for end-user uploads whose storage/DB outcome may be unknown."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from models.base import TypeBase
from models.types import LongText, StringUUID


class UploadQuotaReservation(TypeBase):
    """Immutable upload intent; settlement and metadata insertion share a transaction."""

    __tablename__ = "upload_quota_reservations"
    __table_args__ = (sa.Index("upload_quota_reservation_tenant_idx", "tenant_id", "created_at", "id"),)

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    storage_type: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    key: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    size: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    extension: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False)
    hash: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    source_url: Mapped[str] = mapped_column(LongText, nullable=False)
