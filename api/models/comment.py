"""Workflow comment models."""

from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import TypeBase

from .account import Account
from .base import gen_uuidv7_string
from .engine import db
from .types import StringUUID


class WorkflowComment(TypeBase):
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
        sa.PrimaryKeyConstraint("id", name="workflow_comments_pkey"),
        Index("workflow_comments_app_idx", "tenant_id", "app_id"),
        Index("workflow_comments_created_at_idx", "created_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default_factory=gen_uuidv7_string, init=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    position_x: Mapped[float] = mapped_column(sa.Float)
    position_y: Mapped[float] = mapped_column(sa.Float)
    content: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    resolved_by: Mapped[str | None] = mapped_column(StringUUID, default=None)

    resolved: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"), default=False)
    # Relationships
    replies: Mapped[list[WorkflowCommentReply]] = relationship(
        lambda: WorkflowCommentReply, back_populates="comment", cascade="all, delete-orphan", init=False
    )
    mentions: Mapped[list[WorkflowCommentMention]] = relationship(
        lambda: WorkflowCommentMention, back_populates="comment", cascade="all, delete-orphan", init=False
    )

    @property
    def created_by_account(self):
        """Get creator account."""
        if hasattr(self, "_created_by_account_cache"):
            return self._created_by_account_cache
        return db.session.get(Account, self.created_by)

    def cache_created_by_account(self, account: Account | None) -> None:
        """Cache creator account to avoid extra queries."""
        self._created_by_account_cache = account

    @property
    def resolved_by_account(self):
        """Get resolver account."""
        if hasattr(self, "_resolved_by_account_cache"):
            return self._resolved_by_account_cache
        if self.resolved_by:
            return db.session.get(Account, self.resolved_by)
        return None

    def cache_resolved_by_account(self, account: Account | None) -> None:
        """Cache resolver account to avoid extra queries."""
        self._resolved_by_account_cache = account

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
        participant_ids: set[str] = set()
        participants: list[Account] = []

        # Use account properties to reuse preloaded caches and avoid hidden N+1.
        if self.created_by not in participant_ids:
            participant_ids.add(self.created_by)
            created_by_account = self.created_by_account
            if created_by_account:
                participants.append(created_by_account)

        for reply in self.replies:
            if reply.created_by in participant_ids:
                continue
            participant_ids.add(reply.created_by)
            reply_account = reply.created_by_account
            if reply_account:
                participants.append(reply_account)

        for mention in self.mentions:
            if mention.mentioned_user_id in participant_ids:
                continue
            participant_ids.add(mention.mentioned_user_id)
            mentioned_account = mention.mentioned_user_account
            if mentioned_account:
                participants.append(mentioned_account)

        return participants


class WorkflowCommentReply(TypeBase):
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
        sa.PrimaryKeyConstraint("id", name="workflow_comment_replies_pkey"),
        Index("comment_replies_comment_idx", "comment_id"),
        Index("comment_replies_created_at_idx", "created_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default_factory=gen_uuidv7_string, init=False)
    comment_id: Mapped[str] = mapped_column(
        StringUUID, sa.ForeignKey("workflow_comments.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )
    # Relationships
    comment: Mapped[WorkflowComment] = relationship(lambda: WorkflowComment, back_populates="replies", init=False)

    @property
    def created_by_account(self):
        """Get creator account."""
        if hasattr(self, "_created_by_account_cache"):
            return self._created_by_account_cache
        return db.session.get(Account, self.created_by)

    def cache_created_by_account(self, account: Account | None) -> None:
        """Cache creator account to avoid extra queries."""
        self._created_by_account_cache = account


class WorkflowCommentMention(TypeBase):
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
        sa.PrimaryKeyConstraint("id", name="workflow_comment_mentions_pkey"),
        Index("comment_mentions_comment_idx", "comment_id"),
        Index("comment_mentions_reply_idx", "reply_id"),
        Index("comment_mentions_user_idx", "mentioned_user_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default_factory=gen_uuidv7_string, init=False)
    comment_id: Mapped[str] = mapped_column(
        StringUUID, sa.ForeignKey("workflow_comments.id", ondelete="CASCADE"), nullable=False
    )
    mentioned_user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    reply_id: Mapped[str | None] = mapped_column(
        StringUUID, sa.ForeignKey("workflow_comment_replies.id", ondelete="CASCADE"), nullable=True, default=None
    )

    # Relationships
    comment: Mapped[WorkflowComment] = relationship(lambda: WorkflowComment, back_populates="mentions", init=False)
    reply: Mapped[WorkflowCommentReply | None] = relationship(lambda: WorkflowCommentReply, init=False)

    @property
    def mentioned_user_account(self):
        """Get mentioned account."""
        if hasattr(self, "_mentioned_user_account_cache"):
            return self._mentioned_user_account_cache
        return db.session.get(Account, self.mentioned_user_id)

    def cache_mentioned_user_account(self, account: Account | None) -> None:
        """Cache mentioned account to avoid extra queries."""
        self._mentioned_user_account_cache = account
