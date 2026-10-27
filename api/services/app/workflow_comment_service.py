"""Application service for Console workflow canvas comments.

Comments belong to an app rather than to a workflow version. Every read and write is scoped by the complete
workspace -> app -> comment -> reply owner chain. The service orchestrates and makes no business decisions: reads
return records from the query port; writes turn input into the domain model's value objects before any database work,
so malformed input fails first, then let a `WorkflowCommentAgg` apply the thread's rules inside one change of the thread
repository. After the change commits, the service handles the aggregate's domain events by sending mention
notifications. Use cases return records, so the transport layer never receives an aggregate.
"""

from collections.abc import Callable, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from libs.uuid_utils import uuidv7
from machinery.context import RequestContext
from services.app.workflow_comment_agg import WorkflowCommentAgg, WorkflowCommentContent, WorkflowCommentMentions
from services.app.workflow_comment_errors import WorkflowCommentAppNotFoundError

MENTION_EXCERPT_LENGTH = 200


@dataclass(frozen=True, slots=True)
class WorkflowCommentAccount:
    id: str
    name: str
    email: str
    avatar: str | None


@dataclass(frozen=True, slots=True)
class WorkflowCommentReplyRecord:
    id: str
    content: str
    created_by: str
    created_by_account: WorkflowCommentAccount | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class WorkflowCommentMentionRecord:
    mentioned_user_id: str
    mentioned_user_account: WorkflowCommentAccount | None
    reply_id: str | None


@dataclass(frozen=True, slots=True)
class WorkflowCommentSummary:
    """A comment as listed on the canvas, with counts and participants instead of full threads."""

    id: str
    position_x: float
    position_y: float
    content: str
    created_by: str
    created_by_account: WorkflowCommentAccount | None
    created_at: datetime
    updated_at: datetime
    resolved: bool
    resolved_at: datetime | None
    resolved_by: str | None
    resolved_by_account: WorkflowCommentAccount | None
    reply_count: int
    mention_count: int
    participants: tuple[WorkflowCommentAccount, ...]


@dataclass(frozen=True, slots=True)
class WorkflowCommentDetail:
    id: str
    position_x: float
    position_y: float
    content: str
    created_by: str
    created_by_account: WorkflowCommentAccount | None
    created_at: datetime
    updated_at: datetime
    resolved: bool
    resolved_at: datetime | None
    resolved_by: str | None
    resolved_by_account: WorkflowCommentAccount | None
    replies: tuple[WorkflowCommentReplyRecord, ...]
    mentions: tuple[WorkflowCommentMentionRecord, ...]


@dataclass(frozen=True, slots=True)
class WorkflowCommentCreated:
    id: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class WorkflowCommentUpdated:
    id: str
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class WorkflowCommentResolved:
    id: str
    resolved: bool
    resolved_at: datetime | None
    resolved_by: str | None


@dataclass(frozen=True, slots=True)
class WorkflowCommentDraft:
    content: str
    position_x: float
    position_y: float
    mentioned_user_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class WorkflowCommentEdit:
    """Comment edits; None positions are kept, and None mentions leave the comment's mentions untouched."""

    content: str
    position_x: float | None
    position_y: float | None
    mentioned_user_ids: tuple[str, ...] | None


@dataclass(frozen=True, slots=True)
class WorkflowCommentReplyDraft:
    """Reply content; the mention list always replaces the reply's existing mentions."""

    content: str
    mentioned_user_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class MentionRecipient:
    """A workspace member to notify, with raw profile values; the service applies display fallbacks."""

    email: str
    name: str | None
    interface_language: str | None


@dataclass(frozen=True, slots=True)
class MentionContext:
    """Values read after a change commits, for building its mention notifications."""

    app_name: str | None
    commenter_name: str | None
    recipients: tuple[MentionRecipient, ...]


@dataclass(frozen=True, slots=True)
class WorkflowCommentMentionNotification:
    language: str
    to: str
    mentioned_name: str
    commenter_name: str
    app_name: str
    comment_content: str
    app_url: str


class WorkflowCommentQueries(Protocol):
    """Read-only access for workflow comments, always scoped by workspace and app; returns records and plain values."""

    def app_exists(self, *, workspace_id: str, app_id: str) -> bool:
        """Return whether Console may address the app (normal status, not a hidden backing app)."""
        ...

    def list_comments(self, *, workspace_id: str, app_id: str) -> Sequence[WorkflowCommentSummary]:
        """Return the app's comments, newest first."""
        ...

    def get_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> WorkflowCommentDetail: ...

    def workspace_member_ids(self, *, workspace_id: str, user_ids: Sequence[str]) -> frozenset[str]:
        """Return which of `user_ids` are members of the workspace."""
        ...

    def mention_context(
        self, *, workspace_id: str, app_id: str, actor_id: str, user_ids: Sequence[str]
    ) -> MentionContext:
        """Return the context for notifying `user_ids`, limited to workspace members with an email address."""
        ...


class WorkflowCommentThreads(Protocol):
    """Repository of `WorkflowCommentAgg` threads, always scoped by workspace and app.

    It accepts and returns only the aggregate, rebuilds it from storage without re-running the checks that guard new
    input, and makes no business decisions. `change_comment` loads a thread with its comment row locked; the caller
    applies the aggregate's behavior inside the block, and leaving the block saves what changed in the same
    transaction and commits. Operations raise `WorkflowCommentNotFoundError` when the thread is outside the scope or
    gone.

    Concurrency, rule by rule:
    - Every rule a change applies is decided by the aggregate on state read under the comment row lock, so changes to
      one thread run one after another and each sees the last one: creator-only edits, the one-way resolution that
      keeps its first resolver, reply lookups, and which users a change newly mentions.
    - Content, positions, and mention lists keep the values of the latest change.
    - Deleting reads only `created_by`, which never changes, so it loads without a lock; the delete locks the comment
      row and raises `WorkflowCommentNotFoundError` when the thread was deleted since the load.
    - Not protected: workspace membership is read before the change, so a membership removed in between can still be
      stored as a mention. Notifications reach only users who are members when they are sent.
    """

    def load_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> WorkflowCommentAgg:
        """Return the thread with its replies and mentions, for a decision that needs no lock."""
        ...

    def add_comment(self, *, comment: WorkflowCommentAgg) -> None:
        """Insert a new thread with its replies and mentions."""
        ...

    def change_comment(
        self, *, workspace_id: str, app_id: str, comment_id: str
    ) -> AbstractContextManager[WorkflowCommentAgg]:
        """Yield the locked thread; leaving the block saves only what changed, and an error rolls back everything.

        Run nothing but the aggregate's behavior inside the block: no port calls and no external I/O.
        """
        ...

    def delete_comment(self, *, comment: WorkflowCommentAgg) -> None:
        """Delete the thread with its replies and mentions."""
        ...


class WorkflowCommentMentionNotifier(Protocol):
    def notify(self, notifications: Sequence[WorkflowCommentMentionNotification]) -> None: ...


class WorkflowCommentService:
    def __init__(
        self,
        *,
        threads: WorkflowCommentThreads,
        queries: WorkflowCommentQueries,
        notifier: WorkflowCommentMentionNotifier,
        console_web_url: str,
        now: Callable[[], datetime],
    ) -> None:
        self._threads = threads
        self._queries = queries
        self._notifier = notifier
        self._console_web_url = console_web_url.rstrip("/")
        self._now = now

    def ensure_app(self, context: RequestContext, app_id: str) -> None:
        if not self._queries.app_exists(workspace_id=context.active_workspace_id, app_id=app_id):
            raise WorkflowCommentAppNotFoundError

    def list_comments(self, context: RequestContext, app_id: str) -> tuple[WorkflowCommentSummary, ...]:
        self.ensure_app(context, app_id)
        return tuple(self._queries.list_comments(workspace_id=context.active_workspace_id, app_id=app_id))

    def get_comment(self, context: RequestContext, app_id: str, comment_id: str) -> WorkflowCommentDetail:
        self.ensure_app(context, app_id)
        return self._queries.get_comment(workspace_id=context.active_workspace_id, app_id=app_id, comment_id=comment_id)

    def create_comment(
        self, context: RequestContext, app_id: str, draft: WorkflowCommentDraft
    ) -> WorkflowCommentCreated:
        self.ensure_app(context, app_id)
        content = WorkflowCommentContent(draft.content)
        mentions = self._members_only(context, WorkflowCommentMentions.parse(draft.mentioned_user_ids))
        comment = WorkflowCommentAgg.start(
            comment_id=str(uuidv7()),
            workspace_id=context.active_workspace_id,
            app_id=app_id,
            actor_id=context.account_id,
            content=content,
            position_x=draft.position_x,
            position_y=draft.position_y,
            mentions=mentions,
            now=self._now(),
        )
        self._threads.add_comment(comment=comment)
        self._handle_events(context, app_id, comment)
        return WorkflowCommentCreated(id=comment.id, created_at=comment.created_at)

    def update_comment(
        self, context: RequestContext, app_id: str, comment_id: str, edit: WorkflowCommentEdit
    ) -> WorkflowCommentUpdated:
        self.ensure_app(context, app_id)
        content = WorkflowCommentContent(edit.content)
        mentions = (
            None
            if edit.mentioned_user_ids is None
            else self._members_only(context, WorkflowCommentMentions.parse(edit.mentioned_user_ids))
        )
        with self._change(context, app_id, comment_id) as comment:
            comment.edit(
                actor_id=context.account_id,
                content=content,
                position_x=edit.position_x,
                position_y=edit.position_y,
                mentions=mentions,
                now=self._now(),
            )
        self._handle_events(context, app_id, comment)
        return WorkflowCommentUpdated(id=comment.id, updated_at=comment.updated_at)

    def delete_comment(self, context: RequestContext, app_id: str, comment_id: str) -> None:
        self.ensure_app(context, app_id)
        comment = self._threads.load_comment(
            workspace_id=context.active_workspace_id, app_id=app_id, comment_id=comment_id
        )
        comment.ensure_removable_by(context.account_id)
        self._threads.delete_comment(comment=comment)

    def resolve_comment(self, context: RequestContext, app_id: str, comment_id: str) -> WorkflowCommentResolved:
        self.ensure_app(context, app_id)
        with self._change(context, app_id, comment_id) as comment:
            comment.resolve(actor_id=context.account_id, now=self._now())
        return WorkflowCommentResolved(
            id=comment.id,
            resolved=comment.resolved,
            resolved_at=comment.resolved_at,
            resolved_by=comment.resolved_by,
        )

    def create_reply(
        self, context: RequestContext, app_id: str, comment_id: str, draft: WorkflowCommentReplyDraft
    ) -> WorkflowCommentCreated:
        self.ensure_app(context, app_id)
        content = WorkflowCommentContent(draft.content)
        mentions = self._members_only(context, WorkflowCommentMentions.parse(draft.mentioned_user_ids))
        reply_id = str(uuidv7())
        with self._change(context, app_id, comment_id) as comment:
            comment.add_reply(
                reply_id=reply_id, actor_id=context.account_id, content=content, mentions=mentions, now=self._now()
            )
        self._handle_events(context, app_id, comment)
        return WorkflowCommentCreated(id=reply_id, created_at=comment.reply(reply_id).created_at)

    def update_reply(
        self,
        context: RequestContext,
        app_id: str,
        comment_id: str,
        reply_id: str,
        draft: WorkflowCommentReplyDraft,
    ) -> WorkflowCommentUpdated:
        self.ensure_app(context, app_id)
        content = WorkflowCommentContent(draft.content)
        mentions = self._members_only(context, WorkflowCommentMentions.parse(draft.mentioned_user_ids))
        with self._change(context, app_id, comment_id) as comment:
            comment.edit_reply(
                reply_id=reply_id, actor_id=context.account_id, content=content, mentions=mentions, now=self._now()
            )
        self._handle_events(context, app_id, comment)
        return WorkflowCommentUpdated(id=reply_id, updated_at=comment.reply(reply_id).updated_at)

    def delete_reply(self, context: RequestContext, app_id: str, comment_id: str, reply_id: str) -> None:
        self.ensure_app(context, app_id)
        with self._change(context, app_id, comment_id) as comment:
            comment.remove_reply(reply_id=reply_id, actor_id=context.account_id)

    def _change(
        self, context: RequestContext, app_id: str, comment_id: str
    ) -> AbstractContextManager[WorkflowCommentAgg]:
        return self._threads.change_comment(
            workspace_id=context.active_workspace_id, app_id=app_id, comment_id=comment_id
        )

    def _members_only(self, context: RequestContext, mentions: WorkflowCommentMentions) -> WorkflowCommentMentions:
        """Read which mentioned users are workspace members before the change, since membership is not the thread's."""
        if not mentions.user_ids:
            return mentions
        return mentions.among(
            self._queries.workspace_member_ids(workspace_id=context.active_workspace_id, user_ids=mentions.user_ids)
        )

    def _handle_events(self, context: RequestContext, app_id: str, comment: WorkflowCommentAgg) -> None:
        """Notify the users a committed change newly mentioned."""
        for event in comment.pull_events():
            mentions = self._queries.mention_context(
                workspace_id=context.active_workspace_id,
                app_id=app_id,
                actor_id=event.actor_id,
                user_ids=event.user_ids,
            )
            self._notify(app_id, event.content, mentions)

    def _notify(self, app_id: str, content: str, mentions: MentionContext) -> None:
        if not mentions.recipients:
            return
        app_name = mentions.app_name or "Dify app"
        commenter_name = mentions.commenter_name or "Dify user"
        excerpt = format_comment_excerpt(content)
        app_url = f"{self._console_web_url}/app/{app_id}/workflow"
        self._notifier.notify(
            [
                WorkflowCommentMentionNotification(
                    language=recipient.interface_language or "en-US",
                    to=recipient.email,
                    mentioned_name=recipient.name or recipient.email,
                    commenter_name=commenter_name,
                    app_name=app_name,
                    comment_content=excerpt,
                    app_url=app_url,
                )
                for recipient in mentions.recipients
            ]
        )


def format_comment_excerpt(content: str, max_length: int = MENTION_EXCERPT_LENGTH) -> str:
    """Trim comment content for email display."""
    trimmed = content.strip()
    if len(trimmed) <= max_length:
        return trimmed
    if max_length <= 3:
        return trimmed[:max_length]
    return f"{trimmed[: max_length - 3].rstrip()}..."
