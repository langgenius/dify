"""SQLAlchemy persistence adapter for Console workflow comments.

Reads map rows straight to records. The thread repository rebuilds and saves whole `WorkflowCommentAgg` threads and
makes no business decisions. A change runs in one transaction: it locks the comment row, reads the thread, lets the
caller apply the aggregate's behavior, and then writes only the columns and rows that differ from what it read, so
the aggregate decides on current state and never tracks its changes for persistence.
"""

from collections.abc import Generator, Iterable, Mapping, Sequence
from contextlib import contextmanager
from typing import override

from sqlalchemy import Select, delete, desc, insert, select, update
from sqlalchemy.orm import Session, selectinload, sessionmaker

from models.account import Account, TenantAccountJoin
from models.base import gen_uuidv7_string
from models.comment import WorkflowComment, WorkflowCommentMention
from models.comment import WorkflowCommentReply as WorkflowCommentReplyModel
from models.enums import AppStatus
from models.model import App
from repositories.app.console_visibility import console_visible_condition
from services.app.workflow_comment_agg import WorkflowCommentAgg, WorkflowCommentReply
from services.app.workflow_comment_errors import WorkflowCommentNotFoundError
from services.app.workflow_comment_service import (
    MentionContext,
    MentionRecipient,
    WorkflowCommentAccount,
    WorkflowCommentDetail,
    WorkflowCommentMentionRecord,
    WorkflowCommentQueries,
    WorkflowCommentReplyRecord,
    WorkflowCommentSummary,
    WorkflowCommentThreads,
)


class WorkflowCommentRepository(WorkflowCommentQueries, WorkflowCommentThreads):
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
            comment = session.scalar(self._thread(workspace_id, app_id, comment_id))
            if comment is None:
                raise WorkflowCommentNotFoundError
            accounts = self._load_accounts(session, [comment])
            return self._detail(comment, accounts)

    @override
    def workspace_member_ids(self, *, workspace_id: str, user_ids: Sequence[str]) -> frozenset[str]:
        with self._session_factory() as session:
            return frozenset(
                str(account_id)
                for account_id in session.scalars(
                    select(TenantAccountJoin.account_id).where(
                        TenantAccountJoin.tenant_id == workspace_id,
                        TenantAccountJoin.account_id.in_(user_ids),
                    )
                ).all()
            )

    @override
    def mention_context(
        self, *, workspace_id: str, app_id: str, actor_id: str, user_ids: Sequence[str]
    ) -> MentionContext:
        with self._session_factory() as session:
            accounts = session.scalars(
                select(Account)
                .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                .where(TenantAccountJoin.tenant_id == workspace_id, Account.id.in_(user_ids))
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

    @override
    def load_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> WorkflowCommentAgg:
        with self._session_factory() as session:
            comment = session.scalar(self._thread(workspace_id, app_id, comment_id))
            if comment is None:
                raise WorkflowCommentNotFoundError
            return self._aggregate(comment)

    @override
    def add_comment(self, *, comment: WorkflowCommentAgg) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                insert(WorkflowComment).values(
                    id=comment.id,
                    tenant_id=comment.workspace_id,
                    app_id=comment.app_id,
                    created_by=comment.created_by,
                    created_at=comment.created_at,
                    **_comment_values(comment),
                )
            )
            self._insert_mentions(session, comment, None, comment.mentioned_user_ids)
            for reply in comment.replies:
                self._insert_reply(session, comment, reply)

    @override
    @contextmanager
    def change_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> Generator[WorkflowCommentAgg]:
        with self._session_factory.begin() as session:
            # A locking read waits for any change in progress and then sees its commit, at any isolation level.
            stored = session.scalar(self._thread(workspace_id, app_id, comment_id).with_for_update())
            if stored is None:
                raise WorkflowCommentNotFoundError
            loaded = self._aggregate(stored)
            comment = self._aggregate(stored)
            yield comment
            self._save_changes(session, loaded, comment)

    @override
    def delete_comment(self, *, comment: WorkflowCommentAgg) -> None:
        with self._session_factory.begin() as session:
            self._lock(session, comment)
            session.execute(delete(WorkflowCommentMention).where(WorkflowCommentMention.comment_id == comment.id))
            session.execute(delete(WorkflowCommentReplyModel).where(WorkflowCommentReplyModel.comment_id == comment.id))
            session.execute(delete(WorkflowComment).where(WorkflowComment.id == comment.id))

    @staticmethod
    def _thread(workspace_id: str, app_id: str, comment_id: str) -> Select[tuple[WorkflowComment]]:
        return (
            select(WorkflowComment)
            .options(selectinload(WorkflowComment.replies), selectinload(WorkflowComment.mentions))
            .where(
                WorkflowComment.id == comment_id,
                WorkflowComment.tenant_id == workspace_id,
                WorkflowComment.app_id == app_id,
            )
            .limit(1)
        )

    @classmethod
    def _save_changes(cls, session: Session, loaded: WorkflowCommentAgg, comment: WorkflowCommentAgg) -> None:
        """Write what differs between the thread as read under the lock and after the change."""
        loaded_values = _comment_values(loaded)
        changed_values = {
            column: value for column, value in _comment_values(comment).items() if value != loaded_values[column]
        }
        if changed_values:
            session.execute(
                update(WorkflowComment)
                .where(
                    WorkflowComment.id == comment.id,
                    WorkflowComment.tenant_id == comment.workspace_id,
                    WorkflowComment.app_id == comment.app_id,
                )
                .values(changed_values)
            )
        if comment.mentioned_user_ids != loaded.mentioned_user_ids:
            cls._replace_mentions(session, comment, None, comment.mentioned_user_ids)

        loaded_replies = {reply.id: reply for reply in loaded.replies}
        for reply_id in loaded_replies.keys() - {reply.id for reply in comment.replies}:
            cls._delete_reply(session, comment, reply_id)
        for reply in comment.replies:
            previous = loaded_replies.get(reply.id)
            if previous is None:
                cls._insert_reply(session, comment, reply)
            else:
                cls._update_reply(session, comment, previous, reply)

    @staticmethod
    def _lock(session: Session, comment: WorkflowCommentAgg) -> None:
        """Lock the comment row so writes to one thread serialize; a comment deleted since the load is not found."""
        locked_id = session.scalar(
            select(WorkflowComment.id)
            .where(
                WorkflowComment.id == comment.id,
                WorkflowComment.tenant_id == comment.workspace_id,
                WorkflowComment.app_id == comment.app_id,
            )
            .with_for_update()
        )
        if locked_id is None:
            raise WorkflowCommentNotFoundError

    @classmethod
    def _insert_reply(cls, session: Session, comment: WorkflowCommentAgg, reply: WorkflowCommentReply) -> None:
        session.execute(
            insert(WorkflowCommentReplyModel).values(
                id=reply.id,
                comment_id=comment.id,
                content=reply.content,
                created_by=reply.created_by,
                created_at=reply.created_at,
                updated_at=reply.updated_at,
            )
        )
        cls._insert_mentions(session, comment, reply.id, reply.mentioned_user_ids)

    @classmethod
    def _update_reply(
        cls,
        session: Session,
        comment: WorkflowCommentAgg,
        previous: WorkflowCommentReply,
        reply: WorkflowCommentReply,
    ) -> None:
        if (reply.content, reply.updated_at) != (previous.content, previous.updated_at):
            session.execute(
                update(WorkflowCommentReplyModel)
                .where(WorkflowCommentReplyModel.id == reply.id, WorkflowCommentReplyModel.comment_id == comment.id)
                .values(content=reply.content, updated_at=reply.updated_at)
            )
        if reply.mentioned_user_ids != previous.mentioned_user_ids:
            cls._replace_mentions(session, comment, reply.id, reply.mentioned_user_ids)

    @staticmethod
    def _delete_reply(session: Session, comment: WorkflowCommentAgg, reply_id: str) -> None:
        session.execute(
            delete(WorkflowCommentMention).where(
                WorkflowCommentMention.comment_id == comment.id, WorkflowCommentMention.reply_id == reply_id
            )
        )
        session.execute(
            delete(WorkflowCommentReplyModel).where(
                WorkflowCommentReplyModel.id == reply_id, WorkflowCommentReplyModel.comment_id == comment.id
            )
        )

    @classmethod
    def _replace_mentions(
        cls, session: Session, comment: WorkflowCommentAgg, reply_id: str | None, user_ids: Sequence[str]
    ) -> None:
        """Replace the mentions of the comment itself (`reply_id` None) or of one reply."""
        session.execute(
            delete(WorkflowCommentMention).where(
                WorkflowCommentMention.comment_id == comment.id,
                WorkflowCommentMention.reply_id.is_(None)
                if reply_id is None
                else WorkflowCommentMention.reply_id == reply_id,
            )
        )
        cls._insert_mentions(session, comment, reply_id, user_ids)

    @staticmethod
    def _insert_mentions(
        session: Session, comment: WorkflowCommentAgg, reply_id: str | None, user_ids: Sequence[str]
    ) -> None:
        if not user_ids:
            return
        session.execute(
            insert(WorkflowCommentMention),
            [
                {
                    "id": gen_uuidv7_string(),
                    "comment_id": comment.id,
                    "reply_id": reply_id,
                    "mentioned_user_id": user_id,
                }
                for user_id in user_ids
            ],
        )

    @staticmethod
    def _aggregate(comment: WorkflowComment) -> WorkflowCommentAgg:
        comment_mentions: list[str] = []
        reply_mentions: dict[str, list[str]] = {}
        for mention in comment.mentions:
            if mention.reply_id is None:
                comment_mentions.append(mention.mentioned_user_id)
            else:
                reply_mentions.setdefault(mention.reply_id, []).append(mention.mentioned_user_id)
        return WorkflowCommentAgg(
            id=comment.id,
            workspace_id=comment.tenant_id,
            app_id=comment.app_id,
            content=comment.content,
            position_x=comment.position_x,
            position_y=comment.position_y,
            created_by=comment.created_by,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
            resolved=comment.resolved,
            resolved_at=comment.resolved_at,
            resolved_by=comment.resolved_by,
            mentioned_user_ids=tuple(comment_mentions),
            replies=[
                WorkflowCommentReply(
                    id=reply.id,
                    content=reply.content,
                    created_by=reply.created_by,
                    created_at=reply.created_at,
                    updated_at=reply.updated_at,
                    mentioned_user_ids=tuple(reply_mentions.get(reply.id, ())),
                )
                for reply in comment.replies
            ],
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


def _comment_values(comment: WorkflowCommentAgg) -> dict[str, object]:
    """Columns of the comment row that behaviors can change."""
    return {
        "content": comment.content,
        "position_x": comment.position_x,
        "position_y": comment.position_y,
        "updated_at": comment.updated_at,
        "resolved": comment.resolved,
        "resolved_at": comment.resolved_at,
        "resolved_by": comment.resolved_by,
    }
