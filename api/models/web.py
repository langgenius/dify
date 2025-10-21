from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from models.base import TypeBase

from .engine import db
from .model import Message
from .types import StringUUID


class SavedMessage(TypeBase):
    __tablename__ = "saved_messages"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="saved_message_pkey"),
        sa.Index("saved_message_message_idx", "app_id", "message_id", "created_by_role", "created_by"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"), init=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    message_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_by_role: Mapped[str] = mapped_column(
        String(255), nullable=False, server_default=sa.text("'end_user'::character varying")
    )
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        init=False,
    )

    @property
    def message(self):
        return db.session.query(Message).where(Message.id == self.message_id).first()


class PinnedConversation(TypeBase):
    __tablename__ = "pinned_conversations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="pinned_conversation_pkey"),
        sa.Index("pinned_conversation_conversation_idx", "app_id", "conversation_id", "created_by_role", "created_by"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"), init=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    conversation_id: Mapped[str] = mapped_column(StringUUID)
    created_by_role: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        server_default=sa.text("'end_user'::character varying"),
    )
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        init=False,
    )
