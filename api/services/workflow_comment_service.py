import logging
from collections.abc import Sequence

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.helper import uuid_value
from models import App, TenantAccountJoin, WorkflowComment, WorkflowCommentMention, WorkflowCommentReply
from models.account import Account
from tasks.mail_workflow_comment_task import send_workflow_comment_mention_email_task

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
    def _filter_valid_mentioned_user_ids(mentioned_user_ids: Sequence[str]) -> list[str]:
        """Return deduplicated UUID user IDs in the order provided."""
        unique_user_ids: list[str] = []
        seen: set[str] = set()
        for user_id in mentioned_user_ids:
            if not isinstance(user_id, str):
                continue
            if not uuid_value(user_id):
                continue
            if user_id in seen:
                continue
            seen.add(user_id)
            unique_user_ids.append(user_id)
        return unique_user_ids

    @staticmethod
    def _format_comment_excerpt(content: str, max_length: int = 200) -> str:
        """Trim comment content for email display."""
        trimmed = content.strip()
        if len(trimmed) <= max_length:
            return trimmed
        if max_length <= 3:
            return trimmed[:max_length]
        return f"{trimmed[: max_length - 3].rstrip()}..."

    @staticmethod
    def _build_mention_email_payloads(
        session: Session,
        tenant_id: str,
        app_id: str,
        mentioner_id: str,
        mentioned_user_ids: Sequence[str],
        content: str,
    ) -> list[dict[str, str]]:
        """Prepare email payloads for mentioned users, including the workflow app link."""
        if not mentioned_user_ids:
            return []

        candidate_user_ids = [user_id for user_id in mentioned_user_ids if user_id != mentioner_id]
        if not candidate_user_ids:
            return []

        app_name = session.scalar(select(App.name).where(App.id == app_id, App.tenant_id == tenant_id)) or "Dify app"
        commenter_name = session.scalar(select(Account.name).where(Account.id == mentioner_id)) or "Dify user"
        comment_excerpt = WorkflowCommentService._format_comment_excerpt(content)
        base_url = dify_config.CONSOLE_WEB_URL.rstrip("/")
        app_url = f"{base_url}/app/{app_id}/workflow"

        accounts = session.scalars(
            select(Account)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == tenant_id, Account.id.in_(candidate_user_ids))
        ).all()

        payloads: list[dict[str, str]] = []
        for account in accounts:
            payloads.append(
                {
                    "language": account.interface_language or "en-US",
                    "to": account.email,
                    "mentioned_name": account.name or account.email,
                    "commenter_name": commenter_name,
                    "app_name": app_name,
                    "comment_content": comment_excerpt,
                    "app_url": app_url,
                }
            )
        return payloads

    @staticmethod
    def _dispatch_mention_emails(payloads: Sequence[dict[str, str]]) -> None:
        """Enqueue mention notification emails."""
        for payload in payloads:
            send_workflow_comment_mention_email_task.delay(**payload)

    @staticmethod
    def get_comments(tenant_id: str, app_id: str) -> Sequence[WorkflowComment]:
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

            # Batch preload all Account objects to avoid N+1 queries
            WorkflowCommentService._preload_accounts(session, comments)

            return comments

    @staticmethod
    def _preload_accounts(session: Session, comments: Sequence[WorkflowComment]) -> None:
        """Batch preload Account objects for comments, replies, and mentions."""
        # Collect all user IDs
        user_ids: set[str] = set()
        for comment in comments:
            user_ids.add(comment.created_by)
            if comment.resolved_by:
                user_ids.add(comment.resolved_by)
            user_ids.update(reply.created_by for reply in comment.replies)
            user_ids.update(mention.mentioned_user_id for mention in comment.mentions)

        if not user_ids:
            return

        # Batch query all accounts
        accounts = session.scalars(select(Account).where(Account.id.in_(user_ids))).all()
        account_map = {str(account.id): account for account in accounts}

        # Cache accounts on objects
        for comment in comments:
            comment.cache_created_by_account(account_map.get(comment.created_by))
            comment.cache_resolved_by_account(account_map.get(comment.resolved_by) if comment.resolved_by else None)
            for reply in comment.replies:
                reply.cache_created_by_account(account_map.get(reply.created_by))
            for mention in comment.mentions:
                mention.cache_mentioned_user_account(account_map.get(mention.mentioned_user_id))

    @staticmethod
    def get_comment(tenant_id: str, app_id: str, comment_id: str, session: Session | None = None) -> WorkflowComment:
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

            # Preload accounts to avoid N+1 queries
            WorkflowCommentService._preload_accounts(session, [comment])

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
        mentioned_user_ids: list[str] | None = None,
    ) -> dict:
        """Create a new workflow comment and send mention notification emails."""
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
            mentioned_user_ids = WorkflowCommentService._filter_valid_mentioned_user_ids(mentioned_user_ids or [])
            for user_id in mentioned_user_ids:
                mention = WorkflowCommentMention(
                    comment_id=comment.id,
                    reply_id=None,  # This is a comment mention, not reply mention
                    mentioned_user_id=user_id,
                )
                session.add(mention)

            mention_email_payloads = WorkflowCommentService._build_mention_email_payloads(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                mentioner_id=created_by,
                mentioned_user_ids=mentioned_user_ids,
                content=content,
            )

            session.commit()
            WorkflowCommentService._dispatch_mention_emails(mention_email_payloads)

            # Return only what we need - id and created_at
            return {"id": comment.id, "created_at": comment.created_at}

    @staticmethod
    def update_comment(
        tenant_id: str,
        app_id: str,
        comment_id: str,
        user_id: str,
        content: str,
        position_x: float | None = None,
        position_y: float | None = None,
        mentioned_user_ids: list[str] | None = None,
    ) -> dict:
        """Update a workflow comment and notify newly mentioned users."""
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
            existing_mentioned_user_ids = {mention.mentioned_user_id for mention in existing_mentions}
            for mention in existing_mentions:
                session.delete(mention)

            # Add new mentions
            mentioned_user_ids = WorkflowCommentService._filter_valid_mentioned_user_ids(mentioned_user_ids or [])
            new_mentioned_user_ids = [
                user_id for user_id in mentioned_user_ids if user_id not in existing_mentioned_user_ids
            ]
            for user_id_str in mentioned_user_ids:
                mention = WorkflowCommentMention(
                    comment_id=comment.id,
                    reply_id=None,  # This is a comment mention
                    mentioned_user_id=user_id_str,
                )
                session.add(mention)

            mention_email_payloads = WorkflowCommentService._build_mention_email_payloads(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                mentioner_id=user_id,
                mentioned_user_ids=new_mentioned_user_ids,
                content=content,
            )

            session.commit()
            WorkflowCommentService._dispatch_mention_emails(mention_email_payloads)

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
        comment_id: str, content: str, created_by: str, mentioned_user_ids: list[str] | None = None
    ) -> dict:
        """Add a reply to a workflow comment and notify mentioned users."""
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
            mentioned_user_ids = WorkflowCommentService._filter_valid_mentioned_user_ids(mentioned_user_ids or [])
            for user_id in mentioned_user_ids:
                # Create mention linking to specific reply
                mention = WorkflowCommentMention(comment_id=comment_id, reply_id=reply.id, mentioned_user_id=user_id)
                session.add(mention)

            mention_email_payloads = WorkflowCommentService._build_mention_email_payloads(
                session=session,
                tenant_id=comment.tenant_id,
                app_id=comment.app_id,
                mentioner_id=created_by,
                mentioned_user_ids=mentioned_user_ids,
                content=content,
            )

            session.commit()
            WorkflowCommentService._dispatch_mention_emails(mention_email_payloads)

            return {"id": reply.id, "created_at": reply.created_at}

    @staticmethod
    def update_reply(reply_id: str, user_id: str, content: str, mentioned_user_ids: list[str] | None = None) -> dict:
        """Update a comment reply and notify newly mentioned users."""
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
            existing_mentioned_user_ids = {mention.mentioned_user_id for mention in existing_mentions}
            for mention in existing_mentions:
                session.delete(mention)

            # Add mentions
            mentioned_user_ids = WorkflowCommentService._filter_valid_mentioned_user_ids(mentioned_user_ids or [])
            new_mentioned_user_ids = [
                user_id for user_id in mentioned_user_ids if user_id not in existing_mentioned_user_ids
            ]
            for user_id_str in mentioned_user_ids:
                mention = WorkflowCommentMention(
                    comment_id=reply.comment_id, reply_id=reply.id, mentioned_user_id=user_id_str
                )
                session.add(mention)

            mention_email_payloads: list[dict[str, str]] = []
            comment = session.get(WorkflowComment, reply.comment_id)
            if comment:
                mention_email_payloads = WorkflowCommentService._build_mention_email_payloads(
                    session=session,
                    tenant_id=comment.tenant_id,
                    app_id=comment.app_id,
                    mentioner_id=user_id,
                    mentioned_user_ids=new_mentioned_user_ids,
                    content=content,
                )

            session.commit()
            session.refresh(reply)  # Refresh to get updated timestamp
            WorkflowCommentService._dispatch_mention_emails(mention_email_payloads)

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
