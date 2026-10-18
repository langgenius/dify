"""Application boundary for Console workflow canvas comments.

Comments belong to an app rather than to a workflow version. Every read and write is scoped by the complete
workspace -> app -> comment -> reply owner chain. Reads return records straight from the store. Writes load the
thread as a `WorkflowCommentAgg`, let it apply the thread's rules, save the loaded and changed states through the
same port, and dispatch mention notifications only after that write has committed. Input is checked against the
aggregate's rules before the load, so malformed input fails before any database work. Use cases return records, so
the aggregate never leaves this layer.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from libs.uuid_utils import uuidv7
from machinery.context import RequestContext
from services.app.workflow_comment_agg import WorkflowCommentAgg
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
    """Values read inside the write transaction for building mention notifications."""

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


class WorkflowCommentStore(Protocol):
    """Persistence for workflow comments, always scoped by workspace and app.

    Reads return records. Writes take whole aggregates and run in one bounded transaction that first locks the
    comment row; they raise `WorkflowCommentNotFoundError` when the comment is outside the scope or was deleted after
    the load. The store applies no thread rules. Membership belongs to the workspace, so the store keeps only
    workspace members among the mentioned users inside the write. Writes return the mention context for
    `notify_user_ids`, limited to workspace members with an email address.
    """

    def app_exists(self, *, workspace_id: str, app_id: str) -> bool:
        """Return whether Console may address the app (normal status, not a hidden backing app)."""
        ...

    def list_comments(self, *, workspace_id: str, app_id: str) -> Sequence[WorkflowCommentSummary]:
        """Return the app's comments, newest first."""
        ...

    def get_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> WorkflowCommentDetail: ...

    def load_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> WorkflowCommentAgg:
        """Return the thread with its replies and mentions, or raise `WorkflowCommentNotFoundError`."""
        ...

    def add_comment(self, *, comment: WorkflowCommentAgg, notify_user_ids: Sequence[str]) -> MentionContext:
        """Insert a new thread; its creator is the commenter in the mention context."""
        ...

    def save_comment(
        self, *, loaded: WorkflowCommentAgg, changed: WorkflowCommentAgg, actor_id: str, notify_user_ids: Sequence[str]
    ) -> MentionContext:
        """Write only what differs between `loaded` and `changed`.

        Values the change left alone are never written, so concurrent changes to other parts of the thread survive.
        Raises `WorkflowCommentReplyNotFoundError` when an edited reply was deleted after the load.
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
        comments: WorkflowCommentStore,
        notifier: WorkflowCommentMentionNotifier,
        console_web_url: str,
        now: Callable[[], datetime],
    ) -> None:
        self._comments = comments
        self._notifier = notifier
        self._console_web_url = console_web_url.rstrip("/")
        self._now = now

    def ensure_app(self, context: RequestContext, app_id: str) -> None:
        if not self._comments.app_exists(workspace_id=context.active_workspace_id, app_id=app_id):
            raise WorkflowCommentAppNotFoundError

    def list_comments(self, context: RequestContext, app_id: str) -> tuple[WorkflowCommentSummary, ...]:
        self.ensure_app(context, app_id)
        return tuple(self._comments.list_comments(workspace_id=context.active_workspace_id, app_id=app_id))

    def get_comment(self, context: RequestContext, app_id: str, comment_id: str) -> WorkflowCommentDetail:
        self.ensure_app(context, app_id)
        return self._comments.get_comment(
            workspace_id=context.active_workspace_id, app_id=app_id, comment_id=comment_id
        )

    def create_comment(
        self, context: RequestContext, app_id: str, draft: WorkflowCommentDraft
    ) -> WorkflowCommentCreated:
        self.ensure_app(context, app_id)
        comment = WorkflowCommentAgg.start(
            comment_id=str(uuidv7()),
            workspace_id=context.active_workspace_id,
            app_id=app_id,
            actor_id=context.account_id,
            content=draft.content,
            position_x=draft.position_x,
            position_y=draft.position_y,
            mentioned_user_ids=draft.mentioned_user_ids,
            now=self._now(),
        )
        mentions = self._comments.add_comment(
            comment=comment, notify_user_ids=comment.mentions_to_notify(before=None, actor_id=context.account_id)
        )
        self._notify(app_id, draft.content, mentions)
        return WorkflowCommentCreated(id=comment.id, created_at=comment.created_at)

    def update_comment(
        self, context: RequestContext, app_id: str, comment_id: str, edit: WorkflowCommentEdit
    ) -> WorkflowCommentUpdated:
        self.ensure_app(context, app_id)
        WorkflowCommentAgg.check_input(edit.content, edit.mentioned_user_ids)
        loaded = self._load(context, app_id, comment_id)
        changed = loaded.edit(
            actor_id=context.account_id,
            content=edit.content,
            position_x=edit.position_x,
            position_y=edit.position_y,
            mentioned_user_ids=edit.mentioned_user_ids,
            now=self._now(),
        )
        self._notify(app_id, edit.content, self._save(context, loaded, changed))
        return WorkflowCommentUpdated(id=changed.id, updated_at=changed.updated_at)

    def delete_comment(self, context: RequestContext, app_id: str, comment_id: str) -> None:
        self.ensure_app(context, app_id)
        comment = self._load(context, app_id, comment_id)
        comment.ensure_removable_by(context.account_id)
        self._comments.delete_comment(comment=comment)

    def resolve_comment(self, context: RequestContext, app_id: str, comment_id: str) -> WorkflowCommentResolved:
        self.ensure_app(context, app_id)
        loaded = self._load(context, app_id, comment_id)
        changed = loaded.resolve(actor_id=context.account_id, now=self._now())
        self._save(context, loaded, changed)
        return WorkflowCommentResolved(
            id=changed.id,
            resolved=changed.resolved,
            resolved_at=changed.resolved_at,
            resolved_by=changed.resolved_by,
        )

    def create_reply(
        self, context: RequestContext, app_id: str, comment_id: str, draft: WorkflowCommentReplyDraft
    ) -> WorkflowCommentCreated:
        self.ensure_app(context, app_id)
        WorkflowCommentAgg.check_input(draft.content, draft.mentioned_user_ids)
        loaded = self._load(context, app_id, comment_id)
        reply_id = str(uuidv7())
        changed = loaded.add_reply(
            reply_id=reply_id,
            actor_id=context.account_id,
            content=draft.content,
            mentioned_user_ids=draft.mentioned_user_ids,
            now=self._now(),
        )
        self._notify(app_id, draft.content, self._save(context, loaded, changed))
        return WorkflowCommentCreated(id=reply_id, created_at=changed.reply(reply_id).created_at)

    def update_reply(
        self,
        context: RequestContext,
        app_id: str,
        comment_id: str,
        reply_id: str,
        draft: WorkflowCommentReplyDraft,
    ) -> WorkflowCommentUpdated:
        self.ensure_app(context, app_id)
        WorkflowCommentAgg.check_input(draft.content, draft.mentioned_user_ids)
        loaded = self._load(context, app_id, comment_id)
        changed = loaded.edit_reply(
            reply_id=reply_id,
            actor_id=context.account_id,
            content=draft.content,
            mentioned_user_ids=draft.mentioned_user_ids,
            now=self._now(),
        )
        self._notify(app_id, draft.content, self._save(context, loaded, changed))
        return WorkflowCommentUpdated(id=reply_id, updated_at=changed.reply(reply_id).updated_at)

    def delete_reply(self, context: RequestContext, app_id: str, comment_id: str, reply_id: str) -> None:
        self.ensure_app(context, app_id)
        loaded = self._load(context, app_id, comment_id)
        changed = loaded.remove_reply(reply_id=reply_id, actor_id=context.account_id)
        self._save(context, loaded, changed)

    def _load(self, context: RequestContext, app_id: str, comment_id: str) -> WorkflowCommentAgg:
        return self._comments.load_comment(
            workspace_id=context.active_workspace_id, app_id=app_id, comment_id=comment_id
        )

    def _save(self, context: RequestContext, loaded: WorkflowCommentAgg, changed: WorkflowCommentAgg) -> MentionContext:
        return self._comments.save_comment(
            loaded=loaded,
            changed=changed,
            actor_id=context.account_id,
            notify_user_ids=changed.mentions_to_notify(before=loaded, actor_id=context.account_id),
        )

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
