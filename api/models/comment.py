"""Workflow comment models."""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .account import Account
from .base import Base
from .engine import db
from .types import StringUUID

if TYPE_CHECKING:
    pass


class WorkflowComment(Base):
    """Workflow comment model for canvas commenting functionality.

    Comments are associated with apps rather than specific workflow versions,
    since an app has only one draft workflow at a time and comments should persist
    across workflow version changes.

    Attributes:
        id: Comment ID
        tenant_id: Workspace ID
        app_id: App ID (primary association, comments belong to apps)
        position_x: X coordinate on canvas
        position_y: Y coordinate on canvas
        content: Comment content
        created_by: Creator account ID
        created_at: Creation time
        updated_at: Last update time
        resolved: Whether comment is resolved
        resolved_at: Resolution time
        resolved_by: Resolver account ID
    """

    __tablename__ = "workflow_comments"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="workflow_comments_pkey"),
        Index("workflow_comments_app_idx", "tenant_id", "app_id"),
        Index("workflow_comments_created_at_idx", "created_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    position_x: Mapped[float] = mapped_column(db.Float)
    position_y: Mapped[float] = mapped_column(db.Float)
    content: Mapped[str] = mapped_column(db.Text, nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        db.DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )
    resolved: Mapped[bool] = mapped_column(db.Boolean, nullable=False, server_default=db.text("false"))
    resolved_at: Mapped[Optional[datetime]] = mapped_column(db.DateTime)
    resolved_by: Mapped[Optional[str]] = mapped_column(StringUUID)

    # Relationships
    replies: Mapped[list["WorkflowCommentReply"]] = relationship(
        "WorkflowCommentReply", back_populates="comment", cascade="all, delete-orphan"
    )
    mentions: Mapped[list["WorkflowCommentMention"]] = relationship(
        "WorkflowCommentMention", back_populates="comment", cascade="all, delete-orphan"
    )

    @property
    def created_by_account(self):
        """Get creator account."""
        return db.session.get(Account, self.created_by)

    @property
    def resolved_by_account(self):
        """Get resolver account."""
        if self.resolved_by:
            return db.session.get(Account, self.resolved_by)
        return None

    @property
    def reply_count(self):
        """Get reply count."""
        return len(self.replies)

    @property
    def mention_count(self):
        """Get mention count."""
        return len(self.mentions)

    @property
    def participants(self):
        """Get all participants (creator + repliers + mentioned users)."""
        participant_ids = set()

        # Add comment creator
        participant_ids.add(self.created_by)

        # Add reply creators
        participant_ids.update(reply.created_by for reply in self.replies)

        # Add mentioned users
        participant_ids.update(mention.mentioned_user_id for mention in self.mentions)

        # Get account objects
        participants = []
        for user_id in participant_ids:
            account = db.session.get(Account, user_id)
            if account:
                participants.append(account)

        return participants


class WorkflowCommentReply(Base):
    """Workflow comment reply model.

    Attributes:
        id: Reply ID
        comment_id: Parent comment ID
        content: Reply content
        created_by: Creator account ID
        created_at: Creation time
    """

    __tablename__ = "workflow_comment_replies"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="workflow_comment_replies_pkey"),
        Index("comment_replies_comment_idx", "comment_id"),
        Index("comment_replies_created_at_idx", "created_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    comment_id: Mapped[str] = mapped_column(
        StringUUID, db.ForeignKey("workflow_comments.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(db.Text, nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        db.DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )
    # Relationships
    comment: Mapped["WorkflowComment"] = relationship("WorkflowComment", back_populates="replies")

    @property
    def created_by_account(self):
        """Get creator account."""
        return db.session.get(Account, self.created_by)


class WorkflowCommentMention(Base):
    """Workflow comment mention model.

    Mentions are only for internal accounts since end users
    cannot access workflow canvas and commenting features.

    Attributes:
        id: Mention ID
        comment_id: Parent comment ID
        mentioned_user_id: Mentioned account ID
    """

    __tablename__ = "workflow_comment_mentions"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="workflow_comment_mentions_pkey"),
        Index("comment_mentions_comment_idx", "comment_id"),
        Index("comment_mentions_reply_idx", "reply_id"),
        Index("comment_mentions_user_idx", "mentioned_user_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    comment_id: Mapped[str] = mapped_column(
        StringUUID, db.ForeignKey("workflow_comments.id", ondelete="CASCADE"), nullable=False
    )
    reply_id: Mapped[Optional[str]] = mapped_column(
        StringUUID, db.ForeignKey("workflow_comment_replies.id", ondelete="CASCADE"), nullable=True
    )
    mentioned_user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)

    # Relationships
    comment: Mapped["WorkflowComment"] = relationship("WorkflowComment", back_populates="mentions")
    reply: Mapped[Optional["WorkflowCommentReply"]] = relationship("WorkflowCommentReply")

    @property
    def mentioned_user_account(self):
        """Get mentioned account."""
        return db.session.get(Account, self.mentioned_user_id)
