import logging
from typing import Optional

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload
from werkzeug.exceptions import Forbidden, NotFound

from extensions.ext_database import db
from libs.helper import uuid_value
from models import WorkflowComment, WorkflowCommentMention, WorkflowCommentReply

logger = logging.getLogger(__name__)


class WorkflowCommentService:
    """Service for managing workflow comments."""

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
    def get_comment(tenant_id: str, app_id: str, comment_id: str) -> WorkflowComment:
        """Get a specific comment."""
        with Session(db.engine) as session:
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
        if len(content.strip()) == 0:
            raise ValueError("Comment content cannot be empty")

        if len(content) > 1000:
            raise ValueError("Comment content cannot exceed 1000 characters")
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
                        mentioned_user_id=user_id
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
        mentioned_user_ids: Optional[list[str]] = None,
    ) -> WorkflowComment:
        """Update a workflow comment."""

        comment = WorkflowCommentService.get_comment(tenant_id, app_id, comment_id)

        # Only the creator can update the comment
        if comment.created_by != user_id:
            raise Forbidden("Only the comment creator can update it")

        if len(content.strip()) == 0:
            raise ValueError("Comment content cannot be empty")

        if len(content) > 1000:
            raise ValueError("Comment content cannot exceed 1000 characters")

        comment.content = content

        # Update mentions - first remove existing mentions
        existing_mentions = (
            db.session.query(WorkflowCommentMention).filter(WorkflowCommentMention.comment_id == comment.id).all()
        )
        for mention in existing_mentions:
            db.session.delete(mention)

        # Add new mentions
        mentioned_user_ids = mentioned_user_ids or []
        for user_id_str in mentioned_user_ids:
            if isinstance(user_id_str, str) and uuid_value(user_id_str):
                mention = WorkflowCommentMention(
                    comment_id=comment.id, 
                    reply_id=None,  # This is a comment mention
                    mentioned_user_id=user_id_str
                )
                db.session.add(mention)

        db.session.commit()
        return comment

    @staticmethod
    def delete_comment(tenant_id: str, app_id: str, comment_id: str, user_id: str) -> None:
        """Delete a workflow comment."""
        comment = WorkflowCommentService.get_comment(tenant_id, app_id, comment_id)

        # Only the creator can delete the comment
        if comment.created_by != user_id:
            raise Forbidden("Only the comment creator can delete it")

        db.session.delete(comment)
        db.session.commit()

    @staticmethod
    def resolve_comment(tenant_id: str, app_id: str, comment_id: str, user_id: str) -> WorkflowComment:
        """Resolve a workflow comment."""
        comment = WorkflowCommentService.get_comment(tenant_id, app_id, comment_id)

        if comment.resolved:
            return comment

        comment.resolved = True
        comment.resolved_at = db.func.current_timestamp()
        comment.resolved_by = user_id

        db.session.commit()
        return comment

    @staticmethod
    def reopen_comment(tenant_id: str, app_id: str, comment_id: str, user_id: str) -> WorkflowComment:
        """Reopen a resolved workflow comment."""
        comment = WorkflowCommentService.get_comment(tenant_id, app_id, comment_id)

        if not comment.resolved:
            return comment

        comment.resolved = False
        comment.resolved_at = None
        comment.resolved_by = None

        db.session.commit()
        return comment

    @staticmethod
    def create_reply(
        comment_id: str, 
        content: str, 
        created_by: str,
        mentioned_user_ids: Optional[list[str]] = None
    ) -> dict:
        """Add a reply to a workflow comment."""
        if len(content.strip()) == 0:
            raise ValueError("Reply content cannot be empty")

        if len(content) > 1000:
            raise ValueError("Reply content cannot exceed 1000 characters")

        with Session(db.engine) as session:
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
                        comment_id=comment_id,
                        reply_id=reply.id,  # This is a reply mention
                        mentioned_user_id=user_id
                    )
                    session.add(mention)

            session.commit()
            
            # Return only what we need - id and created_at
            return {
                "id": reply.id,
                "created_at": reply.created_at
            }

    @staticmethod
    def update_reply(
        reply_id: str, 
        user_id: str, 
        content: str,
        mentioned_user_ids: Optional[list[str]] = None
    ) -> WorkflowCommentReply:
        """Update a comment reply."""
        reply = db.session.get(WorkflowCommentReply, reply_id)
        if not reply:
            raise NotFound("Reply not found")

        # Only the creator can update the reply
        if reply.created_by != user_id:
            raise Forbidden("Only the reply creator can update it")

        if len(content.strip()) == 0:
            raise ValueError("Reply content cannot be empty")

        if len(content) > 1000:
            raise ValueError("Reply content cannot exceed 1000 characters")

        reply.content = content

        # Handle mentions for reply updates - add new mentions to parent comment
        mentioned_user_ids = mentioned_user_ids or []
        for user_id_str in mentioned_user_ids:
            if isinstance(user_id_str, str) and uuid_value(user_id_str):
                # Check if mention already exists to avoid duplicates
                existing_mention = db.session.query(WorkflowCommentMention).filter(
                    WorkflowCommentMention.comment_id == reply.comment_id,
                    WorkflowCommentMention.mentioned_user_id == user_id_str
                ).first()
                
                if not existing_mention:
                    mention = WorkflowCommentMention(
                        comment_id=reply.comment_id,
                        reply_id=reply.id,  # This is a reply mention
                        mentioned_user_id=user_id_str
                    )
                    db.session.add(mention)

        db.session.commit()
        return reply

    @staticmethod
    def delete_reply(reply_id: str, user_id: str) -> None:
        """Delete a comment reply."""
        reply = db.session.get(WorkflowCommentReply, reply_id)
        if not reply:
            raise NotFound("Reply not found")

        # Only the creator can delete the reply
        if reply.created_by != user_id:
            raise Forbidden("Only the reply creator can delete it")

        db.session.delete(reply)
        db.session.commit()

    @staticmethod
    def validate_comment_access(comment_id: str, tenant_id: str, app_id: str) -> WorkflowComment:
        """Validate that a comment belongs to the specified tenant and app."""
        return WorkflowCommentService.get_comment(tenant_id, app_id, comment_id)
