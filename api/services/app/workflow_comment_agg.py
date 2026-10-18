"""Aggregate for a Console workflow comment thread: the comment, its replies, and their mentions.

The aggregate enforces the thread's rules. Only the creator of a comment or reply may edit or delete it. Content must
not be blank and may hold at most `MAX_COMMENT_CONTENT_LENGTH` characters. Mention lists keep well-formed account IDs
once each, in input order. Resolving is one-way, and the first resolution is kept. Users a change newly mentions are
notified, except the actor.

The aggregate is immutable and depends only on plain values. Each behavior returns the changed aggregate, so a
service can save the loaded and the changed state together and the repository writes only the difference. The
service supplies new IDs and the current time. Rules that need another aggregate's state, such as keeping only
workspace members among the mentioned users, run inside the repository's write.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Self

from services.app.workflow_comment_errors import (
    InvalidMentionedUserIdError,
    InvalidWorkflowCommentContentError,
    WorkflowCommentPermissionError,
    WorkflowCommentReplyNotFoundError,
)

MAX_COMMENT_CONTENT_LENGTH = 1000


@dataclass(frozen=True, slots=True)
class WorkflowCommentReplyAgg:
    """A reply inside a thread, with the users mentioned in the reply."""

    id: str
    content: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    mentioned_user_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class WorkflowCommentAgg:
    """The thread root, owned by a workspace and an app; `mentioned_user_ids` excludes mentions made in replies."""

    id: str
    workspace_id: str
    app_id: str
    content: str
    position_x: float
    position_y: float
    created_by: str
    created_at: datetime
    updated_at: datetime
    resolved: bool
    resolved_at: datetime | None
    resolved_by: str | None
    mentioned_user_ids: tuple[str, ...]
    replies: tuple[WorkflowCommentReplyAgg, ...]

    @staticmethod
    def check_input(content: str, mentioned_user_ids: Sequence[str] | None) -> None:
        """Apply the content and mention rules alone, so a service rejects bad input before loading a thread."""
        _checked_content(content)
        if mentioned_user_ids is not None:
            _normalized_mentions(mentioned_user_ids)

    @classmethod
    def start(
        cls,
        *,
        comment_id: str,
        workspace_id: str,
        app_id: str,
        actor_id: str,
        content: str,
        position_x: float,
        position_y: float,
        mentioned_user_ids: Sequence[str],
        now: datetime,
    ) -> Self:
        return cls(
            id=comment_id,
            workspace_id=workspace_id,
            app_id=app_id,
            content=_checked_content(content),
            position_x=position_x,
            position_y=position_y,
            created_by=actor_id,
            created_at=now,
            updated_at=now,
            resolved=False,
            resolved_at=None,
            resolved_by=None,
            mentioned_user_ids=_normalized_mentions(mentioned_user_ids),
            replies=(),
        )

    def edit(
        self,
        *,
        actor_id: str,
        content: str,
        position_x: float | None,
        position_y: float | None,
        mentioned_user_ids: Sequence[str] | None,
        now: datetime,
    ) -> Self:
        """Edit as the creator; None positions are kept, and None mentions leave the comment's mentions untouched."""
        checked_content = _checked_content(content)
        mentions = self.mentioned_user_ids if mentioned_user_ids is None else _normalized_mentions(mentioned_user_ids)
        if actor_id != self.created_by:
            raise WorkflowCommentPermissionError("Only the comment creator can update it")
        return replace(
            self,
            content=checked_content,
            position_x=self.position_x if position_x is None else position_x,
            position_y=self.position_y if position_y is None else position_y,
            mentioned_user_ids=mentions,
            updated_at=now,
        )

    def ensure_removable_by(self, actor_id: str) -> None:
        """Deleting the thread removes its replies and mentions too, so only the comment creator may do it."""
        if actor_id != self.created_by:
            raise WorkflowCommentPermissionError("Only the comment creator can delete it")

    def resolve(self, *, actor_id: str, now: datetime) -> Self:
        """Resolve on behalf of any member; an already resolved thread is returned unchanged."""
        if self.resolved:
            return self
        return replace(self, resolved=True, resolved_at=now, resolved_by=actor_id, updated_at=now)

    def reply(self, reply_id: str) -> WorkflowCommentReplyAgg:
        for reply in self.replies:
            if reply.id == reply_id:
                return reply
        raise WorkflowCommentReplyNotFoundError

    def add_reply(
        self, *, reply_id: str, actor_id: str, content: str, mentioned_user_ids: Sequence[str], now: datetime
    ) -> Self:
        reply = WorkflowCommentReplyAgg(
            id=reply_id,
            content=_checked_content(content),
            created_by=actor_id,
            created_at=now,
            updated_at=now,
            mentioned_user_ids=_normalized_mentions(mentioned_user_ids),
        )
        return replace(self, replies=(*self.replies, reply))

    def edit_reply(
        self, *, reply_id: str, actor_id: str, content: str, mentioned_user_ids: Sequence[str], now: datetime
    ) -> Self:
        """Edit a reply as its creator; the mention list always replaces the reply's mentions."""
        checked_content = _checked_content(content)
        mentions = _normalized_mentions(mentioned_user_ids)
        reply = self.reply(reply_id)
        if actor_id != reply.created_by:
            raise WorkflowCommentPermissionError("Only the reply creator can update it")
        edited = replace(reply, content=checked_content, mentioned_user_ids=mentions, updated_at=now)
        return replace(self, replies=tuple(edited if reply.id == reply_id else reply for reply in self.replies))

    def remove_reply(self, *, reply_id: str, actor_id: str) -> Self:
        """Remove a reply with its mentions as the reply creator."""
        if actor_id != self.reply(reply_id).created_by:
            raise WorkflowCommentPermissionError("Only the reply creator can delete it")
        return replace(self, replies=tuple(reply for reply in self.replies if reply.id != reply_id))

    def mentions_to_notify(self, *, before: Self | None, actor_id: str) -> tuple[str, ...]:
        """Return users mentioned here but not in `before` (None for a new thread), first-seen order, without the actor.

        Comment and reply mentions are compared separately, so a user already mentioned in the comment is notified
        again when a reply mentions them.
        """
        earlier_comment_mentions = before.mentioned_user_ids if before is not None else ()
        earlier_reply_mentions = (
            {reply.id: reply.mentioned_user_ids for reply in before.replies} if before is not None else {}
        )
        added = [user_id for user_id in self.mentioned_user_ids if user_id not in earlier_comment_mentions]
        for reply in self.replies:
            earlier = earlier_reply_mentions.get(reply.id, ())
            added.extend(user_id for user_id in reply.mentioned_user_ids if user_id not in earlier)
        return tuple(user_id for user_id in dict.fromkeys(added) if user_id != actor_id)


def _checked_content(content: str) -> str:
    if len(content.strip()) == 0:
        raise InvalidWorkflowCommentContentError("Comment content cannot be empty")
    if len(content) > MAX_COMMENT_CONTENT_LENGTH:
        raise InvalidWorkflowCommentContentError(
            f"Comment content cannot exceed {MAX_COMMENT_CONTENT_LENGTH} characters"
        )
    return content


def _normalized_mentions(mentioned_user_ids: Sequence[str]) -> tuple[str, ...]:
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
