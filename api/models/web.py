from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base

from .engine import db
from .model import Message
from .types import StringUUID


class SavedMessage(Base):
    __tablename__ = "saved_messages"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="saved_message_pkey"),
        db.Index("saved_message_message_idx", "app_id", "message_id", "created_by_role", "created_by"),
    )

    id = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=False)
    message_id = mapped_column(StringUUID, nullable=False)
    created_by_role = mapped_column(
        String(255), nullable=False, server_default=db.text("'end_user'::character varying")
    )
    created_by = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def message(self):
        return db.session.query(Message).where(Message.id == self.message_id).first()


class PinnedConversation(Base):
    __tablename__ = "pinned_conversations"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="pinned_conversation_pkey"),
        db.Index("pinned_conversation_conversation_idx", "app_id", "conversation_id", "created_by_role", "created_by"),
    )

    id = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=False)
    conversation_id: Mapped[str] = mapped_column(StringUUID)
    created_by_role = mapped_column(
        String(255), nullable=False, server_default=db.text("'end_user'::character varying")
    )
    created_by = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
