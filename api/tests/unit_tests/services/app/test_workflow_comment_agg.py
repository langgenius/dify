"""Workflow comment thread rules, exercised on the aggregate alone."""

import datetime
from collections.abc import Callable

import pytest

from services.app.workflow_comment_agg import (
    MAX_COMMENT_CONTENT_LENGTH,
    WorkflowCommentAgg,
    WorkflowCommentReplyAgg,
)
from services.app.workflow_comment_errors import (
    InvalidMentionedUserIdError,
    InvalidWorkflowCommentContentError,
    WorkflowCommentPermissionError,
    WorkflowCommentReplyNotFoundError,
)

CREATOR = "33333333-3333-3333-3333-333333333333"
OTHER = "33333333-3333-3333-3333-333333333334"
USER_A = "33333333-3333-3333-3333-333333333335"
USER_B = "33333333-3333-3333-3333-333333333336"
STARTED_AT = datetime.datetime(2024, 1, 1, 12, 0, 0)
NOW = datetime.datetime(2024, 1, 2, 12, 0, 0)


def _thread(*, mentioned_user_ids: tuple[str, ...] = (USER_A,)) -> WorkflowCommentAgg:
    return WorkflowCommentAgg.start(
        comment_id="comment-1",
        workspace_id="workspace-1",
        app_id="app-1",
        actor_id=CREATOR,
        content="hello",
        position_x=1.0,
        position_y=2.0,
        mentioned_user_ids=mentioned_user_ids,
        now=STARTED_AT,
    )


def _with_reply(*, created_by: str = OTHER, mentioned_user_ids: tuple[str, ...] = (USER_A,)) -> WorkflowCommentAgg:
    return _thread().add_reply(
        reply_id="reply-1", actor_id=created_by, content="reply", mentioned_user_ids=mentioned_user_ids, now=STARTED_AT
    )


def test_start_opens_an_unresolved_thread_owned_by_the_actor() -> None:
    comment = _thread(mentioned_user_ids=(USER_A, "", USER_B, USER_A))

    assert comment == WorkflowCommentAgg(
        id="comment-1",
        workspace_id="workspace-1",
        app_id="app-1",
        content="hello",
        position_x=1.0,
        position_y=2.0,
        created_by=CREATOR,
        created_at=STARTED_AT,
        updated_at=STARTED_AT,
        resolved=False,
        resolved_at=None,
        resolved_by=None,
        mentioned_user_ids=(USER_A, USER_B),
        replies=(),
    )


type ContentWrite = Callable[[str], object]

CONTENT_WRITES: list[ContentWrite] = [
    lambda content: WorkflowCommentAgg.check_input(content, None),
    lambda content: WorkflowCommentAgg.start(
        comment_id="comment-1",
        workspace_id="workspace-1",
        app_id="app-1",
        actor_id=CREATOR,
        content=content,
        position_x=0,
        position_y=0,
        mentioned_user_ids=(),
        now=NOW,
    ),
    lambda content: _thread().edit(
        actor_id=CREATOR, content=content, position_x=None, position_y=None, mentioned_user_ids=None, now=NOW
    ),
    lambda content: _thread().add_reply(
        reply_id="reply-2", actor_id=OTHER, content=content, mentioned_user_ids=(), now=NOW
    ),
    lambda content: _with_reply().edit_reply(
        reply_id="reply-1", actor_id=OTHER, content=content, mentioned_user_ids=(), now=NOW
    ),
]


@pytest.mark.parametrize("write", CONTENT_WRITES)
@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("   ", "Comment content cannot be empty"),
        ("a" * (MAX_COMMENT_CONTENT_LENGTH + 1), "Comment content cannot exceed 1000 characters"),
    ],
    ids=["blank", "too-long"],
)
def test_every_write_applies_the_content_rules(write: ContentWrite, content: str, message: str) -> None:
    with pytest.raises(InvalidWorkflowCommentContentError, match=message):
        write(content)


def test_content_at_the_length_limit_is_accepted() -> None:
    content = "a" * MAX_COMMENT_CONTENT_LENGTH

    assert (
        _thread()
        .add_reply(reply_id="reply-1", actor_id=OTHER, content=content, mentioned_user_ids=(), now=NOW)
        .reply("reply-1")
        .content
        == content
    )


type MentionWrite = Callable[[tuple[str, ...]], object]

MENTION_WRITES: list[MentionWrite] = [
    lambda mentions: WorkflowCommentAgg.check_input("hi", mentions),
    lambda mentions: _thread(mentioned_user_ids=mentions),
    lambda mentions: _thread().edit(
        actor_id=CREATOR, content="hi", position_x=None, position_y=None, mentioned_user_ids=mentions, now=NOW
    ),
    lambda mentions: _thread().add_reply(
        reply_id="reply-2", actor_id=OTHER, content="hi", mentioned_user_ids=mentions, now=NOW
    ),
    lambda mentions: _with_reply().edit_reply(
        reply_id="reply-1", actor_id=OTHER, content="hi", mentioned_user_ids=mentions, now=NOW
    ),
]


@pytest.mark.parametrize("write", MENTION_WRITES)
def test_every_write_rejects_malformed_mention_ids(write: MentionWrite) -> None:
    with pytest.raises(InvalidMentionedUserIdError, match="not-a-uuid is not a valid uuid."):
        write((USER_A, "not-a-uuid"))


def test_input_rules_apply_before_the_creator_check() -> None:
    with pytest.raises(InvalidWorkflowCommentContentError):
        _thread().edit(actor_id=OTHER, content=" ", position_x=None, position_y=None, mentioned_user_ids=None, now=NOW)


def test_edit_keeps_omitted_positions_and_mentions() -> None:
    loaded = _thread()

    edited = loaded.edit(
        actor_id=CREATOR, content="updated", position_x=10.5, position_y=None, mentioned_user_ids=None, now=NOW
    )

    assert (edited.content, edited.position_x, edited.position_y) == ("updated", 10.5, 2.0)
    assert edited.mentioned_user_ids == (USER_A,)
    assert (edited.created_at, edited.updated_at) == (STARTED_AT, NOW)
    # Behaviors return a new aggregate; the loaded state stays as it was for the save.
    assert loaded.content == "hello"


def test_edit_replaces_the_comment_mentions_but_not_reply_mentions() -> None:
    edited = _with_reply().edit(
        actor_id=CREATOR, content="hello", position_x=None, position_y=None, mentioned_user_ids=(), now=NOW
    )

    assert edited.mentioned_user_ids == ()
    assert edited.reply("reply-1").mentioned_user_ids == (USER_A,)


def test_only_the_comment_creator_edits_or_removes_it() -> None:
    comment = _thread()

    with pytest.raises(WorkflowCommentPermissionError, match="Only the comment creator can update it"):
        comment.edit(actor_id=OTHER, content="x", position_x=None, position_y=None, mentioned_user_ids=None, now=NOW)
    with pytest.raises(WorkflowCommentPermissionError, match="Only the comment creator can delete it"):
        comment.ensure_removable_by(OTHER)
    comment.ensure_removable_by(CREATOR)


def test_any_member_resolves_and_the_first_resolution_is_kept() -> None:
    resolved = _thread().resolve(actor_id=OTHER, now=NOW)

    assert (resolved.resolved, resolved.resolved_at, resolved.resolved_by) == (True, NOW, OTHER)
    assert resolved.updated_at == NOW
    assert resolved.resolve(actor_id=CREATOR, now=NOW + datetime.timedelta(hours=1)) is resolved


def test_add_reply_appends_a_reply_owned_by_the_actor() -> None:
    comment = _with_reply().add_reply(
        reply_id="reply-2", actor_id=CREATOR, content="again", mentioned_user_ids=(USER_B, USER_B), now=NOW
    )

    assert [reply.id for reply in comment.replies] == ["reply-1", "reply-2"]
    assert comment.reply("reply-2") == WorkflowCommentReplyAgg(
        id="reply-2",
        content="again",
        created_by=CREATOR,
        created_at=NOW,
        updated_at=NOW,
        mentioned_user_ids=(USER_B,),
    )
    # Adding a reply does not touch the comment itself.
    assert comment.updated_at == STARTED_AT


def test_edit_reply_replaces_content_and_mentions_of_that_reply_only() -> None:
    comment = _with_reply().add_reply(
        reply_id="reply-2", actor_id=CREATOR, content="again", mentioned_user_ids=(), now=STARTED_AT
    )

    edited = comment.edit_reply(
        reply_id="reply-1", actor_id=OTHER, content="new", mentioned_user_ids=(USER_B,), now=NOW
    )

    reply = edited.reply("reply-1")
    assert (reply.content, reply.mentioned_user_ids, reply.updated_at) == ("new", (USER_B,), NOW)
    assert edited.reply("reply-2") == comment.reply("reply-2")


def test_only_the_reply_creator_edits_or_removes_it() -> None:
    comment = _with_reply(created_by=OTHER)

    with pytest.raises(WorkflowCommentPermissionError, match="Only the reply creator can update it"):
        comment.edit_reply(reply_id="reply-1", actor_id=CREATOR, content="x", mentioned_user_ids=(), now=NOW)
    with pytest.raises(WorkflowCommentPermissionError, match="Only the reply creator can delete it"):
        comment.remove_reply(reply_id="reply-1", actor_id=CREATOR)


def test_remove_reply_drops_the_reply_with_its_mentions() -> None:
    comment = _with_reply()

    assert comment.remove_reply(reply_id="reply-1", actor_id=OTHER).replies == ()


type ReplyLookup = Callable[[WorkflowCommentAgg], object]


@pytest.mark.parametrize(
    "lookup",
    [
        lambda comment: comment.reply("missing"),
        lambda comment: comment.edit_reply(
            reply_id="missing", actor_id=OTHER, content="x", mentioned_user_ids=(), now=NOW
        ),
        lambda comment: comment.remove_reply(reply_id="missing", actor_id=OTHER),
    ],
)
def test_unknown_reply_is_not_found(lookup: ReplyLookup) -> None:
    with pytest.raises(WorkflowCommentReplyNotFoundError):
        lookup(_with_reply())


def test_a_new_thread_notifies_everyone_it_mentions_except_the_actor() -> None:
    comment = _thread(mentioned_user_ids=(USER_B, CREATOR, USER_A))

    assert comment.mentions_to_notify(before=None, actor_id=CREATOR) == (USER_B, USER_A)


def test_a_change_notifies_only_users_it_newly_mentions() -> None:
    loaded = _thread(mentioned_user_ids=(USER_A,))

    edited = loaded.edit(
        actor_id=CREATOR,
        content="hello",
        position_x=None,
        position_y=None,
        mentioned_user_ids=(USER_A, USER_B, CREATOR),
        now=NOW,
    )

    assert edited.mentions_to_notify(before=loaded, actor_id=CREATOR) == (USER_B,)
    assert loaded.resolve(actor_id=OTHER, now=NOW).mentions_to_notify(before=loaded, actor_id=OTHER) == ()


def test_reply_mentions_are_compared_with_the_same_reply_only() -> None:
    loaded = _with_reply(mentioned_user_ids=(USER_B,))

    replied = loaded.add_reply(
        reply_id="reply-2", actor_id=OTHER, content="again", mentioned_user_ids=(USER_A, USER_B), now=NOW
    )
    edited = loaded.edit_reply(
        reply_id="reply-1", actor_id=OTHER, content="reply", mentioned_user_ids=(USER_B, USER_A), now=NOW
    )

    # USER_A is already mentioned on the comment and USER_B in the first reply; the new reply still notifies both.
    assert replied.mentions_to_notify(before=loaded, actor_id=OTHER) == (USER_A, USER_B)
    assert edited.mentions_to_notify(before=loaded, actor_id=OTHER) == (USER_A,)


def test_check_input_accepts_omitted_mentions() -> None:
    WorkflowCommentAgg.check_input("hello", None)
    WorkflowCommentAgg.check_input("hello", (USER_A, ""))
