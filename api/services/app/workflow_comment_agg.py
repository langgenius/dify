"""Domain model for a Console workflow comment thread: the comment, its replies, and their mentions.

`WorkflowCommentAgg` is the aggregate root. Like its child entity `WorkflowCommentReply`, it is an entity: its identity
is fixed when it is created and stays the same for its whole lifecycle, equality follows that identity, and its state
changes in place through the root's behaviors, which enforce the thread's rules. Only the creator of a comment or reply
may edit or delete it. Resolving is one-way, and the first resolution is kept. A change that newly mentions users
records a `WorkflowCommentUsersMentioned` event, without the actor.

Content and mention lists are value objects that check their own rules when they are built. The model is business
logic only: it performs no I/O, keeps no persistence state, and receives new identifiers and the current time from the
application service. Workspace membership belongs to another aggregate, so the service reads which mentioned users are
members before a change, and the mention list keeps only those.
"""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
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
class WorkflowCommentContent:
    """The text of a comment or reply: not blank and at most `MAX_COMMENT_CONTENT_LENGTH` characters."""

    text: str

    def __post_init__(self) -> None:
        if len(self.text.strip()) == 0:
            raise InvalidWorkflowCommentContentError("Comment content cannot be empty")
        if len(self.text) > MAX_COMMENT_CONTENT_LENGTH:
            raise InvalidWorkflowCommentContentError(
                f"Comment content cannot exceed {MAX_COMMENT_CONTENT_LENGTH} characters"
            )


@dataclass(frozen=True, slots=True)
class WorkflowCommentMentions:
    """Well-formed account IDs of mentioned users, in first-seen order; `parse` builds one from request input."""

    user_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        for user_id in self.user_ids:
            try:
                uuid.UUID(user_id)
            except ValueError as error:
                raise InvalidMentionedUserIdError(user_id) from error

    @classmethod
    def parse(cls, user_ids: Sequence[str]) -> Self:
        """Skip empty IDs, keep each ID once in input order, and reject malformed ones."""
        return cls(tuple(dict.fromkeys(user_id for user_id in user_ids if user_id)))

    def among(self, member_ids: Collection[str]) -> Self:
        """Keep only users in `member_ids`, the workspace members the service read before the change."""
        return type(self)(tuple(user_id for user_id in self.user_ids if user_id in member_ids))


@dataclass(frozen=True, slots=True)
class WorkflowCommentUsersMentioned:
    """Users one change newly mentioned, other than its actor, with the text that mentions them."""

    actor_id: str
    user_ids: tuple[str, ...]
    content: str


@dataclass(eq=False, slots=True)
class WorkflowCommentReply:
    """A reply inside a thread, with the users mentioned in the reply; change it only through the root."""

    id: str
    content: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    mentioned_user_ids: tuple[str, ...]

    def __eq__(self, other: object) -> bool:
        return isinstance(other, WorkflowCommentReply) and other.id == self.id

    def __hash__(self) -> int:
        return hash(self.id)


@dataclass(eq=False, slots=True)
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
    replies: list[WorkflowCommentReply]
    _events: list[WorkflowCommentUsersMentioned] = field(default_factory=list, init=False, repr=False)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, WorkflowCommentAgg) and other.id == self.id

    def __hash__(self) -> int:
        return hash(self.id)

    @classmethod
    def start(
        cls,
        *,
        comment_id: str,
        workspace_id: str,
        app_id: str,
        actor_id: str,
        content: WorkflowCommentContent,
        position_x: float,
        position_y: float,
        mentions: WorkflowCommentMentions,
        now: datetime,
    ) -> Self:
        comment = cls(
            id=comment_id,
            workspace_id=workspace_id,
            app_id=app_id,
            content=content.text,
            position_x=position_x,
            position_y=position_y,
            created_by=actor_id,
            created_at=now,
            updated_at=now,
            resolved=False,
            resolved_at=None,
            resolved_by=None,
            mentioned_user_ids=mentions.user_ids,
            replies=[],
        )
        comment._record_mentions(actor_id=actor_id, mentions=mentions, earlier=(), content=content)
        return comment

    def edit(
        self,
        *,
        actor_id: str,
        content: WorkflowCommentContent,
        position_x: float | None,
        position_y: float | None,
        mentions: WorkflowCommentMentions | None,
        now: datetime,
    ) -> None:
        """Edit as the creator; None positions are kept, and None mentions leave the comment's mentions untouched."""
        if actor_id != self.created_by:
            raise WorkflowCommentPermissionError("Only the comment creator can update it")
        if mentions is not None:
            self._record_mentions(
                actor_id=actor_id, mentions=mentions, earlier=self.mentioned_user_ids, content=content
            )
            self.mentioned_user_ids = mentions.user_ids
        self.content = content.text
        if position_x is not None:
            self.position_x = position_x
        if position_y is not None:
            self.position_y = position_y
        self.updated_at = now

    def ensure_removable_by(self, actor_id: str) -> None:
        """Deleting the thread removes its replies and mentions too, so only the comment creator may do it."""
        if actor_id != self.created_by:
            raise WorkflowCommentPermissionError("Only the comment creator can delete it")

    def resolve(self, *, actor_id: str, now: datetime) -> None:
        """Resolve on behalf of any member; an already resolved thread keeps its first resolution."""
        if self.resolved:
            return
        self.resolved = True
        self.resolved_at = now
        self.resolved_by = actor_id
        self.updated_at = now

    def reply(self, reply_id: str) -> WorkflowCommentReply:
        for reply in self.replies:
            if reply.id == reply_id:
                return reply
        raise WorkflowCommentReplyNotFoundError

    def add_reply(
        self,
        *,
        reply_id: str,
        actor_id: str,
        content: WorkflowCommentContent,
        mentions: WorkflowCommentMentions,
        now: datetime,
    ) -> None:
        self.replies.append(
            WorkflowCommentReply(
                id=reply_id,
                content=content.text,
                created_by=actor_id,
                created_at=now,
                updated_at=now,
                mentioned_user_ids=mentions.user_ids,
            )
        )
        self._record_mentions(actor_id=actor_id, mentions=mentions, earlier=(), content=content)

    def edit_reply(
        self,
        *,
        reply_id: str,
        actor_id: str,
        content: WorkflowCommentContent,
        mentions: WorkflowCommentMentions,
        now: datetime,
    ) -> None:
        """Edit a reply as its creator; the mention list always replaces the reply's mentions."""
        reply = self.reply(reply_id)
        if actor_id != reply.created_by:
            raise WorkflowCommentPermissionError("Only the reply creator can update it")
        self._record_mentions(actor_id=actor_id, mentions=mentions, earlier=reply.mentioned_user_ids, content=content)
        reply.content = content.text
        reply.mentioned_user_ids = mentions.user_ids
        reply.updated_at = now

    def remove_reply(self, *, reply_id: str, actor_id: str) -> None:
        """Remove a reply with its mentions as the reply creator."""
        reply = self.reply(reply_id)
        if actor_id != reply.created_by:
            raise WorkflowCommentPermissionError("Only the reply creator can delete it")
        self.replies.remove(reply)

    def pull_events(self) -> tuple[WorkflowCommentUsersMentioned, ...]:
        """Return the events recorded since the last call and forget them, so each is handled once."""
        events = tuple(self._events)
        self._events.clear()
        return events

    def _record_mentions(
        self,
        *,
        actor_id: str,
        mentions: WorkflowCommentMentions,
        earlier: Collection[str],
        content: WorkflowCommentContent,
    ) -> None:
        """Record users not in `earlier`, the same scope's previous mentions.

        The comment and each reply are separate scopes, so a reply notifies a user the comment already mentions.
        """
        added = tuple(user_id for user_id in mentions.user_ids if user_id not in earlier and user_id != actor_id)
        if added:
            self._events.append(WorkflowCommentUsersMentioned(actor_id=actor_id, user_ids=added, content=content.text))
