"""Application boundary for Console workflow canvas comments.

Comments belong to an app rather than to a workflow version. Every read and write is scoped by the complete
workspace -> app -> comment -> reply owner chain, and only the creator of a comment or reply may edit or delete it.
Mention notifications are dispatched only after the store has committed the write.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from machinery.context import RequestContext

MAX_COMMENT_CONTENT_LENGTH = 1000
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
class WorkflowCommentWrite[T]:
    result: T
    mentions: MentionContext


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

    Write methods run in one bounded transaction. They raise `WorkflowCommentNotFoundError` or
    `WorkflowCommentReplyNotFoundError` when the target is outside the scope, and
    `WorkflowCommentPermissionError` when `actor_id` did not create it. Mention IDs are already
    normalized; the store keeps only workspace members and reports recipients for newly mentioned
    members other than the actor.
    """

    def app_exists(self, *, workspace_id: str, app_id: str) -> bool:
        """Return whether Console may address the app (normal status, not a hidden backing app)."""
        ...

    def list_comments(self, *, workspace_id: str, app_id: str) -> Sequence[WorkflowCommentSummary]:
        """Return the app's comments, newest first."""
        ...

    def get_comment(self, *, workspace_id: str, app_id: str, comment_id: str) -> WorkflowCommentDetail: ...

    def insert_comment(
        self, *, workspace_id: str, app_id: str, actor_id: str, draft: WorkflowCommentDraft
    ) -> WorkflowCommentWrite[WorkflowCommentCreated]: ...

    def update_comment(
        self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str, edit: WorkflowCommentEdit
    ) -> WorkflowCommentWrite[WorkflowCommentUpdated]: ...

    def delete_comment(self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str) -> None:
        """Delete the comment with its replies and mentions."""
        ...

    def resolve_comment(
        self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str
    ) -> WorkflowCommentResolved:
        """Mark the comment resolved by any member; an already resolved comment is returned unchanged."""
        ...

    def insert_reply(
        self, *, workspace_id: str, app_id: str, comment_id: str, actor_id: str, draft: WorkflowCommentReplyDraft
    ) -> WorkflowCommentWrite[WorkflowCommentCreated]: ...

    def update_reply(
        self,
        *,
        workspace_id: str,
        app_id: str,
        comment_id: str,
        reply_id: str,
        actor_id: str,
        draft: WorkflowCommentReplyDraft,
    ) -> WorkflowCommentWrite[WorkflowCommentUpdated]: ...

    def delete_reply(self, *, workspace_id: str, app_id: str, comment_id: str, reply_id: str, actor_id: str) -> None:
        """Delete the reply with its mentions."""
        ...


class WorkflowCommentMentionNotifier(Protocol):
    def notify(self, notifications: Sequence[WorkflowCommentMentionNotification]) -> None: ...


class WorkflowCommentError(Exception):
    """Base class for framework-neutral workflow comment failures."""


class WorkflowCommentAppNotFoundError(WorkflowCommentError):
    def __init__(self) -> None:
        super().__init__("App not found")


class WorkflowCommentNotFoundError(WorkflowCommentError):
    def __init__(self) -> None:
        super().__init__("Comment not found")


class WorkflowCommentReplyNotFoundError(WorkflowCommentError):
    def __init__(self) -> None:
        super().__init__("Reply not found")


class WorkflowCommentPermissionError(WorkflowCommentError):
    """Raised when an account edits or deletes a comment or reply it did not create."""


class InvalidWorkflowCommentContentError(WorkflowCommentError):
    pass


class InvalidMentionedUserIdError(WorkflowCommentError):
    def __init__(self, user_id: str) -> None:
        super().__init__(f"{user_id} is not a valid uuid.")


class WorkflowCommentService:
    def __init__(
        self,
        *,
        comments: WorkflowCommentStore,
        notifier: WorkflowCommentMentionNotifier,
        console_web_url: str,
    ) -> None:
        self._comments = comments
        self._notifier = notifier
        self._console_web_url = console_web_url.rstrip("/")

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
        _validate_content(draft.content)
        write = self._comments.insert_comment(
            workspace_id=context.active_workspace_id,
            app_id=app_id,
            actor_id=context.account_id,
            draft=WorkflowCommentDraft(
                content=draft.content,
                position_x=draft.position_x,
                position_y=draft.position_y,
                mentioned_user_ids=normalize_mentioned_user_ids(draft.mentioned_user_ids),
            ),
        )
        self._notify(app_id, draft.content, write.mentions)
        return write.result

    def update_comment(
        self, context: RequestContext, app_id: str, comment_id: str, edit: WorkflowCommentEdit
    ) -> WorkflowCommentUpdated:
        self.ensure_app(context, app_id)
        _validate_content(edit.content)
        mentioned_user_ids = edit.mentioned_user_ids
        write = self._comments.update_comment(
            workspace_id=context.active_workspace_id,
            app_id=app_id,
            comment_id=comment_id,
            actor_id=context.account_id,
            edit=WorkflowCommentEdit(
                content=edit.content,
                position_x=edit.position_x,
                position_y=edit.position_y,
                mentioned_user_ids=(
                    normalize_mentioned_user_ids(mentioned_user_ids) if mentioned_user_ids is not None else None
                ),
            ),
        )
        self._notify(app_id, edit.content, write.mentions)
        return write.result

    def delete_comment(self, context: RequestContext, app_id: str, comment_id: str) -> None:
        self.ensure_app(context, app_id)
        self._comments.delete_comment(
            workspace_id=context.active_workspace_id,
            app_id=app_id,
            comment_id=comment_id,
            actor_id=context.account_id,
        )

    def resolve_comment(self, context: RequestContext, app_id: str, comment_id: str) -> WorkflowCommentResolved:
        self.ensure_app(context, app_id)
        return self._comments.resolve_comment(
            workspace_id=context.active_workspace_id,
            app_id=app_id,
            comment_id=comment_id,
            actor_id=context.account_id,
        )

    def create_reply(
        self, context: RequestContext, app_id: str, comment_id: str, draft: WorkflowCommentReplyDraft
    ) -> WorkflowCommentCreated:
        self.ensure_app(context, app_id)
        _validate_content(draft.content)
        write = self._comments.insert_reply(
            workspace_id=context.active_workspace_id,
            app_id=app_id,
            comment_id=comment_id,
            actor_id=context.account_id,
            draft=WorkflowCommentReplyDraft(
                content=draft.content,
                mentioned_user_ids=normalize_mentioned_user_ids(draft.mentioned_user_ids),
            ),
        )
        self._notify(app_id, draft.content, write.mentions)
        return write.result

    def update_reply(
        self,
        context: RequestContext,
        app_id: str,
        comment_id: str,
        reply_id: str,
        draft: WorkflowCommentReplyDraft,
    ) -> WorkflowCommentUpdated:
        self.ensure_app(context, app_id)
        _validate_content(draft.content)
        write = self._comments.update_reply(
            workspace_id=context.active_workspace_id,
            app_id=app_id,
            comment_id=comment_id,
            reply_id=reply_id,
            actor_id=context.account_id,
            draft=WorkflowCommentReplyDraft(
                content=draft.content,
                mentioned_user_ids=normalize_mentioned_user_ids(draft.mentioned_user_ids),
            ),
        )
        self._notify(app_id, draft.content, write.mentions)
        return write.result

    def delete_reply(self, context: RequestContext, app_id: str, comment_id: str, reply_id: str) -> None:
        self.ensure_app(context, app_id)
        self._comments.delete_reply(
            workspace_id=context.active_workspace_id,
            app_id=app_id,
            comment_id=comment_id,
            reply_id=reply_id,
            actor_id=context.account_id,
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


def normalize_mentioned_user_ids(mentioned_user_ids: Sequence[str]) -> tuple[str, ...]:
    """Return deduplicated user IDs in input order, skipping empty IDs and rejecting malformed ones."""
    unique_user_ids: dict[str, None] = {}
    for user_id in mentioned_user_ids:
        if not user_id:
            continue
        try:
            uuid.UUID(user_id)
        except ValueError as error:
            raise InvalidMentionedUserIdError(user_id) from error
        unique_user_ids.setdefault(user_id, None)
    return tuple(unique_user_ids)


def format_comment_excerpt(content: str, max_length: int = MENTION_EXCERPT_LENGTH) -> str:
    """Trim comment content for email display."""
    trimmed = content.strip()
    if len(trimmed) <= max_length:
        return trimmed
    if max_length <= 3:
        return trimmed[:max_length]
    return f"{trimmed[: max_length - 3].rstrip()}..."


def _validate_content(content: str) -> None:
    if len(content.strip()) == 0:
        raise InvalidWorkflowCommentContentError("Comment content cannot be empty")
    if len(content) > MAX_COMMENT_CONTENT_LENGTH:
        raise InvalidWorkflowCommentContentError(
            f"Comment content cannot exceed {MAX_COMMENT_CONTENT_LENGTH} characters"
        )
