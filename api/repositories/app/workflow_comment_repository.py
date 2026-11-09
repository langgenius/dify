"""SQLAlchemy persistence adapter for Console workflow comments."""

from collections.abc import Collection, Iterable, Mapping, Sequence
from typing import override

from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.account import Account, TenantAccountJoin
from models.comment import WorkflowComment, WorkflowCommentMention, WorkflowCommentReply
from models.enums import AppStatus
from models.model import App
from repositories.app.console_visibility import console_visible_condition
from services.app.workflow_comment_service import (
    MentionContext,
    MentionRecipient,
    WorkflowCommentAccount,
    WorkflowCommentCreated,
    WorkflowCommentDetail,
    WorkflowCommentDraft,
    WorkflowCommentEdit,
    WorkflowCommentMentionRecord,
    WorkflowCommentNotFoundError,
    WorkflowCommentPermissionError,
    WorkflowCommentReplyDraft,
    WorkflowCommentReplyNotFoundError,
    WorkflowCommentReplyRecord,
    WorkflowCommentResolved,
    WorkflowCommentStore,
    WorkflowCommentSummary,
    WorkflowCommentUpdated,
    WorkflowCommentWrite,
)

_NO_MENTIONS = MentionContext(app_name=None, commenter_name=None, recipients=())


class WorkflowCommentRepository(WorkflowCommentStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def app_exists(self, *, workspace_id: str, app_id: str) -> bool:
        with self._session_factory() as session:
            found = session.scalar(
                select(App.id)
                .where(
                    App.id == app_id,
                    App.tenant_id == workspace_id,
                    App.status == AppStatus.NORMAL,
                    console_visible_condition(),
                )
                .limit(1)
            )
        return found is not None

    @override
    def list_comments(self, *, workspace_id: str, app_id: str) -> tuple[WorkflowCommentSummary, ...]:
        with self._session_factory() as session:
            comments = session.scalars(
                select(WorkflowComment)
                .options(selectinload(WorkflowComment.replies), selectinload(WorkflowComment.mentions))
                .where(WorkflowComment.tenant_id == workspace_id, WorkflowComment.app_id == app_id)
                .order_by(desc(WorkflowComment.created_at))
            ).all()
            accounts = self._load_accounts(session, comments)
            return tuple(self._summary(comment, accounts) for comment in comments)

    @override
    def get_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> WorkflowCommentDetail:
        with self._session_factory() as session:
            comment = session.scalar(
                select(WorkflowComment)
                .options(selectinload(WorkflowComment.replies), selectinload(WorkflowComment.mentions))
                .where(
                    WorkflowComment.id == comment_id,
                    WorkflowComment.tenant_id == workspace_id,
                    WorkflowComment.app_id == app_id,
                )
                .limit(1)
            )
            if comment is None:
                raise WorkflowCommentNotFoundError
            accounts = self._load_accounts(session, [comment])
            return self._detail(comment, accounts)

    @override
    def insert_comment(
        self, *, workspace_id: str, app_id: str, actor_id: str, draft: WorkflowCommentDraft
    ) -> WorkflowCommentWrite[WorkflowCommentCreated]:
        with self._session_factory.begin() as session:
            comment = WorkflowComment(
                tenant_id=workspace_id,
                app_id=app_id,
                position_x=draft.position_x,
                position_y=draft.position_y,
                content=draft.content,
                created_by=actor_id,
            )
            session.add(comment)
            session.flush()

            mentioned_user_ids = self._workspace_member_ids(session, workspace_id, draft.mentioned_user_ids)
            session.add_all(
                WorkflowCommentMention(comment_id=comment.id, reply_id=None, mentioned_user_id=user_id)
                for user_id in mentioned_user_ids
            )
            mentions = self._mention_context(session, workspace_id, app_id, actor_id, mentioned_user_ids)
            session.flush()
            session.refresh(comment, ["created_at"])
            return WorkflowCommentWrite(
                result=WorkflowCommentCreated(id=comment.id, created_at=comment.created_at),
                mentions=mentions,
            )

    @override
    def update_comment(
        self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str, edit: WorkflowCommentEdit
    ) -> WorkflowCommentWrite[WorkflowCommentUpdated]:
        with self._session_factory.begin() as session:
            comment = self._require_comment(session, workspace_id, app_id, comment_id)
            if comment.created_by != actor_id:
                raise WorkflowCommentPermissionError("Only the comment creator can update it")

            comment.content = edit.content
            if edit.position_x is not None:
                comment.position_x = edit.position_x
            if edit.position_y is not None:
                comment.position_y = edit.position_y

            mentions = _NO_MENTIONS
            if edit.mentioned_user_ids is not None:
                # Replace the comment's own mentions only when the client sends a mention list.
                existing_mentions = session.scalars(
                    select(WorkflowCommentMention).where(
                        WorkflowCommentMention.comment_id == comment.id,
                        WorkflowCommentMention.reply_id.is_(None),
                    )
                ).all()
                previously_mentioned = {mention.mentioned_user_id for mention in existing_mentions}
                for mention in existing_mentions:
                    session.delete(mention)

                mentioned_user_ids = self._workspace_member_ids(session, workspace_id, edit.mentioned_user_ids)
                session.add_all(
                    WorkflowCommentMention(comment_id=comment.id, reply_id=None, mentioned_user_id=user_id)
                    for user_id in mentioned_user_ids
                )
                mentions = self._mention_context(
                    session,
                    workspace_id,
                    app_id,
                    actor_id,
                    [user_id for user_id in mentioned_user_ids if user_id not in previously_mentioned],
                )

            session.flush()
            session.refresh(comment, ["updated_at"])
            return WorkflowCommentWrite(
                result=WorkflowCommentUpdated(id=comment.id, updated_at=comment.updated_at),
                mentions=mentions,
            )

    @override
    def delete_comment(self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str) -> None:
        with self._session_factory.begin() as session:
            comment = self._require_comment(session, workspace_id, app_id, comment_id)
            if comment.created_by != actor_id:
                raise WorkflowCommentPermissionError("Only the comment creator can delete it")

            session.execute(delete(WorkflowCommentMention).where(WorkflowCommentMention.comment_id == comment.id))
            session.execute(delete(WorkflowCommentReply).where(WorkflowCommentReply.comment_id == comment.id))
            session.delete(comment)

    @override
    def resolve_comment(
        self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str
    ) -> WorkflowCommentResolved:
        with self._session_factory.begin() as session:
            comment = self._require_comment(session, workspace_id, app_id, comment_id)
            if not comment.resolved:
                comment.resolved = True
                comment.resolved_at = naive_utc_now()
                comment.resolved_by = actor_id
            return WorkflowCommentResolved(
                id=comment.id,
                resolved=comment.resolved,
                resolved_at=comment.resolved_at,
                resolved_by=comment.resolved_by,
            )

    @override
    def insert_reply(
        self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str, draft: WorkflowCommentReplyDraft
    ) -> WorkflowCommentWrite[WorkflowCommentCreated]:
        with self._session_factory.begin() as session:
            comment = self._require_comment(session, workspace_id, app_id, comment_id)
            reply = WorkflowCommentReply(comment_id=comment.id, content=draft.content, created_by=actor_id)
            session.add(reply)
            session.flush()

            mentioned_user_ids = self._workspace_member_ids(session, workspace_id, draft.mentioned_user_ids)
            session.add_all(
                WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=user_id)
                for user_id in mentioned_user_ids
            )
            mentions = self._mention_context(session, workspace_id, app_id, actor_id, mentioned_user_ids)
            session.flush()
            session.refresh(reply, ["created_at"])
            return WorkflowCommentWrite(
                result=WorkflowCommentCreated(id=reply.id, created_at=reply.created_at),
                mentions=mentions,
            )

    @override
    def update_reply(
        self,
        *,
        workspace_id: str,
        app_id: str,
        comment_id: str,
        reply_id: str,
        actor_id: str,
        draft: WorkflowCommentReplyDraft,
    ) -> WorkflowCommentWrite[WorkflowCommentUpdated]:
        with self._session_factory.begin() as session:
            reply = self._require_reply(session, workspace_id, app_id, comment_id, reply_id)
            if reply.created_by != actor_id:
                raise WorkflowCommentPermissionError("Only the reply creator can update it")

            reply.content = draft.content
            existing_mentions = session.scalars(
                select(WorkflowCommentMention).where(WorkflowCommentMention.reply_id == reply.id)
            ).all()
            previously_mentioned = {mention.mentioned_user_id for mention in existing_mentions}
            for mention in existing_mentions:
                session.delete(mention)

            mentioned_user_ids = self._workspace_member_ids(session, workspace_id, draft.mentioned_user_ids)
            session.add_all(
                WorkflowCommentMention(comment_id=reply.comment_id, reply_id=reply.id, mentioned_user_id=user_id)
                for user_id in mentioned_user_ids
            )
            mentions = self._mention_context(
                session,
                workspace_id,
                app_id,
                actor_id,
                [user_id for user_id in mentioned_user_ids if user_id not in previously_mentioned],
            )
            session.flush()
            session.refresh(reply, ["updated_at"])
            return WorkflowCommentWrite(
                result=WorkflowCommentUpdated(id=reply.id, updated_at=reply.updated_at),
                mentions=mentions,
            )

    @override
    def delete_reply(self, *, workspace_id: str, app_id: str, comment_id: str, reply_id: str, actor_id: str) -> None:
        with self._session_factory.begin() as session:
            reply = self._require_reply(session, workspace_id, app_id, comment_id, reply_id)
            if reply.created_by != actor_id:
                raise WorkflowCommentPermissionError("Only the reply creator can delete it")

            session.execute(delete(WorkflowCommentMention).where(WorkflowCommentMention.reply_id == reply.id))
            session.delete(reply)

    @staticmethod
    def _require_comment(session: Session, workspace_id: str, app_id: str, comment_id: str) -> WorkflowComment:
        comment = session.scalar(
            select(WorkflowComment)
            .where(
                WorkflowComment.id == comment_id,
                WorkflowComment.tenant_id == workspace_id,
                WorkflowComment.app_id == app_id,
            )
            .limit(1)
        )
        if comment is None:
            raise WorkflowCommentNotFoundError
        return comment

    @classmethod
    def _require_reply(
        cls, session: Session, workspace_id: str, app_id: str, comment_id: str, reply_id: str
    ) -> WorkflowCommentReply:
        """Require the reply inside its comment's scope; a missing comment is reported before a missing reply."""
        cls._require_comment(session, workspace_id, app_id, comment_id)
        reply = session.scalar(
            select(WorkflowCommentReply)
            .where(WorkflowCommentReply.id == reply_id, WorkflowCommentReply.comment_id == comment_id)
            .limit(1)
        )
        if reply is None:
            raise WorkflowCommentReplyNotFoundError
        return reply

    @staticmethod
    def _workspace_member_ids(session: Session, workspace_id: str, user_ids: Sequence[str]) -> list[str]:
        """Keep only IDs of workspace members, preserving the caller's order."""
        if not user_ids:
            return []
        member_ids = {
            str(account_id)
            for account_id in session.scalars(
                select(TenantAccountJoin.account_id).where(
                    TenantAccountJoin.tenant_id == workspace_id,
                    TenantAccountJoin.account_id.in_(user_ids),
                )
            ).all()
        }
        return [user_id for user_id in user_ids if user_id in member_ids]

    @staticmethod
    def _mention_context(
        session: Session, workspace_id: str, app_id: str, actor_id: str, mentioned_user_ids: Collection[str]
    ) -> MentionContext:
        recipient_ids = [user_id for user_id in mentioned_user_ids if user_id != actor_id]
        if not recipient_ids:
            return _NO_MENTIONS

        accounts = session.scalars(
            select(Account)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == workspace_id, Account.id.in_(recipient_ids))
        ).all()
        return MentionContext(
            app_name=session.scalar(select(App.name).where(App.id == app_id, App.tenant_id == workspace_id)),
            commenter_name=session.scalar(select(Account.name).where(Account.id == actor_id)),
            recipients=tuple(
                MentionRecipient(
                    email=account.email,
                    name=account.name,
                    interface_language=account.interface_language,
                )
                for account in accounts
                if account.email
            ),
        )

    @staticmethod
    def _load_accounts(session: Session, comments: Iterable[WorkflowComment]) -> dict[str, WorkflowCommentAccount]:
        """Batch-load every account referenced by the comments, their replies, and mentions."""
        user_ids: set[str] = set()
        for comment in comments:
            user_ids.add(comment.created_by)
            if comment.resolved_by:
                user_ids.add(comment.resolved_by)
            user_ids.update(reply.created_by for reply in comment.replies)
            user_ids.update(mention.mentioned_user_id for mention in comment.mentions)
        if not user_ids:
            return {}

        return {
            str(account.id): WorkflowCommentAccount(
                id=str(account.id),
                name=account.name,
                email=account.email,
                avatar=account.avatar,
            )
            for account in session.scalars(select(Account).where(Account.id.in_(user_ids))).all()
        }

    @classmethod
    def _summary(
        cls, comment: WorkflowComment, accounts: Mapping[str, WorkflowCommentAccount]
    ) -> WorkflowCommentSummary:
        return WorkflowCommentSummary(
            id=comment.id,
            position_x=comment.position_x,
            position_y=comment.position_y,
            content=comment.content,
            created_by=comment.created_by,
            created_by_account=accounts.get(comment.created_by),
            created_at=comment.created_at,
            updated_at=comment.updated_at,
            resolved=comment.resolved,
            resolved_at=comment.resolved_at,
            resolved_by=comment.resolved_by,
            resolved_by_account=accounts.get(comment.resolved_by) if comment.resolved_by else None,
            reply_count=len(comment.replies),
            mention_count=len(comment.mentions),
            participants=cls._participants(comment, accounts),
        )

    @staticmethod
    def _detail(comment: WorkflowComment, accounts: Mapping[str, WorkflowCommentAccount]) -> WorkflowCommentDetail:
        return WorkflowCommentDetail(
            id=comment.id,
            position_x=comment.position_x,
            position_y=comment.position_y,
            content=comment.content,
            created_by=comment.created_by,
            created_by_account=accounts.get(comment.created_by),
            created_at=comment.created_at,
            updated_at=comment.updated_at,
            resolved=comment.resolved,
            resolved_at=comment.resolved_at,
            resolved_by=comment.resolved_by,
            resolved_by_account=accounts.get(comment.resolved_by) if comment.resolved_by else None,
            replies=tuple(
                WorkflowCommentReplyRecord(
                    id=reply.id,
                    content=reply.content,
                    created_by=reply.created_by,
                    created_by_account=accounts.get(reply.created_by),
                    created_at=reply.created_at,
                )
                for reply in comment.replies
            ),
            mentions=tuple(
                WorkflowCommentMentionRecord(
                    mentioned_user_id=mention.mentioned_user_id,
                    mentioned_user_account=accounts.get(mention.mentioned_user_id),
                    reply_id=mention.reply_id,
                )
                for mention in comment.mentions
            ),
        )

    @staticmethod
    def _participants(
        comment: WorkflowComment, accounts: Mapping[str, WorkflowCommentAccount]
    ) -> tuple[WorkflowCommentAccount, ...]:
        """Return the creator, repliers, then mentioned users, each once and in first-seen order."""
        participant_ids = dict.fromkeys(
            [
                comment.created_by,
                *(reply.created_by for reply in comment.replies),
                *(mention.mentioned_user_id for mention in comment.mentions),
            ]
        )
        return tuple(accounts[user_id] for user_id in participant_ids if user_id in accounts)
