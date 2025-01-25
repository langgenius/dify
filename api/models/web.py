from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from .engine import db
from .model import Message
from .types import StringUUID


class SavedMessage(db.Model):  # type: ignore[name-defined]
    __tablename__ = "saved_messages"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="saved_message_pkey"),
        db.Index("saved_message_message_idx", "app_id", "message_id", "created_by_role", "created_by"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    message_id = db.Column(StringUUID, nullable=False)
    created_by_role = db.Column(db.String(255), nullable=False, server_default=db.text("'end_user'::character varying"))
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def message(self):
        return db.session.query(Message).filter(Message.id == self.message_id).first()


class PinnedConversation(db.Model):  # type: ignore[name-defined]
    __tablename__ = "pinned_conversations"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="pinned_conversation_pkey"),
        db.Index("pinned_conversation_conversation_idx", "app_id", "conversation_id", "created_by_role", "created_by"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    conversation_id: Mapped[str] = mapped_column(StringUUID)
    created_by_role = db.Column(db.String(255), nullable=False, server_default=db.text("'end_user'::character varying"))
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
