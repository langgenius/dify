"""One file parked on the server for a short time, owned by the caller that prepared or received it."""

from datetime import datetime
from typing import Final

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from models.base import DefaultFieldsDCMixin, TypeBase

NAME_MAX_LENGTH: Final = 255
MIME_TYPE_MAX_LENGTH: Final = 255


class FileTransfer(DefaultFieldsDCMixin, TypeBase):
    """A transfer belongs to its owner, as a personal access token does, and has no workspace.
    Whatever reads it does its own workspace checks.

    ``name``, ``mime_type``, ``size``, ``sha256`` and ``received_at`` are null until a file arrived.
    """

    __tablename__ = "file_transfers"
    __table_args__ = (
        sa.Index("file_transfer_owner_created_idx", "owner_id", "created_at"),
        sa.Index("file_transfer_expires_idx", "expires_at"),
        sa.CheckConstraint("direction IN ('in', 'out')", name="file_transfer_direction"),
    )

    owner_id: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    token_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False, repr=False)
    direction: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    folder: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False)
    name: Mapped[str | None] = mapped_column(sa.String(NAME_MAX_LENGTH), default=None)
    mime_type: Mapped[str | None] = mapped_column(sa.String(MIME_TYPE_MAX_LENGTH), default=None)
    size: Mapped[int | None] = mapped_column(sa.BigInteger, default=None)
    sha256: Mapped[str | None] = mapped_column(sa.String(64), default=None)
    received_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
