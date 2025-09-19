import logging
from typing import Optional

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload
from werkzeug.exceptions import Forbidden, NotFound

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.helper import uuid_value
from models import WorkflowComment, WorkflowCommentMention, WorkflowCommentReply

logger = logging.getLogger(__name__)


class WorkflowCommentService:
    """Service for managing workflow comments."""

    @staticmethod
    def _validate_content(content: str) -> None:
        if len(content.strip()) == 0:
            raise ValueError("Comment content cannot be empty")

        if len(content) > 1000:
            raise ValueError("Comment content cannot exceed 1000 characters")

    @staticmethod
    def get_comments(tenant_id: str, app_id: str) -> list[WorkflowComment]:
        """Get all comments for a workflow."""
        with Session(db.engine) as session:
            # Get all comments with eager loading
            stmt = (
                select(WorkflowComment)
                .options(selectinload(WorkflowComment.replies), selectinload(WorkflowComment.mentions))
                .where(WorkflowComment.tenant_id == tenant_id, WorkflowComment.app_id == app_id)
                .order_by(desc(WorkflowComment.created_at))
            )

            comments = session.scalars(stmt).all()
            return comments

    @staticmethod
    def get_comment(tenant_id: str, app_id: str, comment_id: str, session: Session = None) -> WorkflowComment:
        """Get a specific comment."""

        def _get_comment(session: Session) -> WorkflowComment:
            stmt = (
                select(WorkflowComment)
                .options(selectinload(WorkflowComment.replies), selectinload(WorkflowComment.mentions))
                .where(
                    WorkflowComment.id == comment_id,
                    WorkflowComment.tenant_id == tenant_id,
                    WorkflowComment.app_id == app_id,
                )
            )
            comment = session.scalar(stmt)

            if not comment:
                raise NotFound("Comment not found")

            return comment

        if session is not None:
            return _get_comment(session)
        else:
            with Session(db.engine, expire_on_commit=False) as session:
                return _get_comment(session)

    @staticmethod
    def create_comment(
        tenant_id: str,
        app_id: str,
        created_by: str,
        content: str,
        position_x: float,
        position_y: float,
        mentioned_user_ids: Optional[list[str]] = None,
    ) -> WorkflowComment:
        """Create a new workflow comment."""
        WorkflowCommentService._validate_content(content)

        with Session(db.engine) as session:
            comment = WorkflowComment(
                tenant_id=tenant_id,
                app_id=app_id,
                position_x=position_x,
                position_y=position_y,
                content=content,
                created_by=created_by,
            )

            session.add(comment)
            session.flush()  # Get the comment ID for mentions

            # Create mentions if specified
            mentioned_user_ids = mentioned_user_ids or []
            for user_id in mentioned_user_ids:
                if isinstance(user_id, str) and uuid_value(user_id):
                    mention = WorkflowCommentMention(
                        comment_id=comment.id,
                        reply_id=None,  # This is a comment mention, not reply mention
                        mentioned_user_id=user_id,
                    )
                    session.add(mention)

            session.commit()

            # Return only what we need - id and created_at
            return {"id": comment.id, "created_at": comment.created_at}

    @staticmethod
    def update_comment(
        tenant_id: str,
        app_id: str,
        comment_id: str,
        user_id: str,
        content: str,
        position_x: Optional[float] = None,
        position_y: Optional[float] = None,
        mentioned_user_ids: Optional[list[str]] = None,
    ) -> dict:
        """Update a workflow comment."""
        WorkflowCommentService._validate_content(content)

        with Session(db.engine, expire_on_commit=False) as session:
            # Get comment with validation
            stmt = select(WorkflowComment).where(
                WorkflowComment.id == comment_id,
                WorkflowComment.tenant_id == tenant_id,
                WorkflowComment.app_id == app_id,
            )
            comment = session.scalar(stmt)

            if not comment:
                raise NotFound("Comment not found")

            # Only the creator can update the comment
            if comment.created_by != user_id:
                raise Forbidden("Only the comment creator can update it")

            # Update comment fields
            comment.content = content
            if position_x is not None:
                comment.position_x = position_x
            if position_y is not None:
                comment.position_y = position_y

            # Update mentions - first remove existing mentions for this comment only (not replies)
            existing_mentions = session.scalars(
                select(WorkflowCommentMention).where(
                    WorkflowCommentMention.comment_id == comment.id,
                    WorkflowCommentMention.reply_id.is_(None),  # Only comment mentions, not reply mentions
                )
            ).all()
            for mention in existing_mentions:
                session.delete(mention)

            # Add new mentions
            mentioned_user_ids = mentioned_user_ids or []
            for user_id_str in mentioned_user_ids:
                if isinstance(user_id_str, str) and uuid_value(user_id_str):
                    mention = WorkflowCommentMention(
                        comment_id=comment.id,
                        reply_id=None,  # This is a comment mention
                        mentioned_user_id=user_id_str,
                    )
                    session.add(mention)

            session.commit()

            return {"id": comment.id, "updated_at": comment.updated_at}

    @staticmethod
    def delete_comment(tenant_id: str, app_id: str, comment_id: str, user_id: str) -> None:
        """Delete a workflow comment."""
        with Session(db.engine, expire_on_commit=False) as session:
            comment = WorkflowCommentService.get_comment(tenant_id, app_id, comment_id, session)

            # Only the creator can delete the comment
            if comment.created_by != user_id:
                raise Forbidden("Only the comment creator can delete it")

            # Delete associated mentions (both comment and reply mentions)
            mentions = session.scalars(
                select(WorkflowCommentMention).where(WorkflowCommentMention.comment_id == comment_id)
            ).all()
            for mention in mentions:
                session.delete(mention)

            # Delete associated replies
            replies = session.scalars(
                select(WorkflowCommentReply).where(WorkflowCommentReply.comment_id == comment_id)
            ).all()
            for reply in replies:
                session.delete(reply)

            session.delete(comment)
            session.commit()

    @staticmethod
    def resolve_comment(tenant_id: str, app_id: str, comment_id: str, user_id: str) -> WorkflowComment:
        """Resolve a workflow comment."""
        with Session(db.engine, expire_on_commit=False) as session:
            comment = WorkflowCommentService.get_comment(tenant_id, app_id, comment_id, session)
            if comment.resolved:
                return comment

            comment.resolved = True
            comment.resolved_at = naive_utc_now()
            comment.resolved_by = user_id
            session.commit()

        return comment

    @staticmethod
    def create_reply(
        comment_id: str, content: str, created_by: str, mentioned_user_ids: Optional[list[str]] = None
    ) -> dict:
        """Add a reply to a workflow comment."""
        WorkflowCommentService._validate_content(content)

        with Session(db.engine, expire_on_commit=False) as session:
            # Check if comment exists
            comment = session.get(WorkflowComment, comment_id)
            if not comment:
                raise NotFound("Comment not found")

            reply = WorkflowCommentReply(comment_id=comment_id, content=content, created_by=created_by)

            session.add(reply)
            session.flush()  # Get the reply ID for mentions

            # Create mentions if specified
            mentioned_user_ids = mentioned_user_ids or []
            for user_id in mentioned_user_ids:
                if isinstance(user_id, str) and uuid_value(user_id):
                    # Create mention linking to specific reply
                    mention = WorkflowCommentMention(
                        comment_id=comment_id, reply_id=reply.id, mentioned_user_id=user_id
                    )
                    session.add(mention)

            session.commit()

            return {"id": reply.id, "created_at": reply.created_at}

    @staticmethod
    def update_reply(
        reply_id: str, user_id: str, content: str, mentioned_user_ids: Optional[list[str]] = None
    ) -> WorkflowCommentReply:
        """Update a comment reply."""
        WorkflowCommentService._validate_content(content)

        with Session(db.engine, expire_on_commit=False) as session:
            reply = session.get(WorkflowCommentReply, reply_id)
            if not reply:
                raise NotFound("Reply not found")

            # Only the creator can update the reply
            if reply.created_by != user_id:
                raise Forbidden("Only the reply creator can update it")

            reply.content = content

            # Update mentions - first remove existing mentions for this reply
            existing_mentions = session.scalars(
                select(WorkflowCommentMention).where(WorkflowCommentMention.reply_id == reply.id)
            ).all()
            for mention in existing_mentions:
                session.delete(mention)

            # Add mentions
            mentioned_user_ids = mentioned_user_ids or []
            for user_id_str in mentioned_user_ids:
                if isinstance(user_id_str, str) and uuid_value(user_id_str):
                    mention = WorkflowCommentMention(
                        comment_id=reply.comment_id, reply_id=reply.id, mentioned_user_id=user_id_str
                    )
                    session.add(mention)

            session.commit()
            session.refresh(reply)  # Refresh to get updated timestamp

            return {"id": reply.id, "updated_at": reply.updated_at}

    @staticmethod
    def delete_reply(reply_id: str, user_id: str) -> None:
        """Delete a comment reply."""
        with Session(db.engine, expire_on_commit=False) as session:
            reply = session.get(WorkflowCommentReply, reply_id)
            if not reply:
                raise NotFound("Reply not found")

            # Only the creator can delete the reply
            if reply.created_by != user_id:
                raise Forbidden("Only the reply creator can delete it")

            # Delete associated mentions first
            mentions = session.scalars(
                select(WorkflowCommentMention).where(WorkflowCommentMention.reply_id == reply_id)
            ).all()
            for mention in mentions:
                session.delete(mention)

            session.delete(reply)
            session.commit()

    @staticmethod
    def validate_comment_access(comment_id: str, tenant_id: str, app_id: str) -> WorkflowComment:
        """Validate that a comment belongs to the specified tenant and app."""
        return WorkflowCommentService.get_comment(tenant_id, app_id, comment_id)
