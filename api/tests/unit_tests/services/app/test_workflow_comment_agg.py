"""Workflow comment thread rules, exercised on the domain model alone."""

import datetime
from collections.abc import Callable

import pytest

from services.app.workflow_comment_agg import (
    MAX_COMMENT_CONTENT_LENGTH,
    WorkflowCommentAgg,
    WorkflowCommentContent,
    WorkflowCommentMentions,
    WorkflowCommentReply,
    WorkflowCommentUsersMentioned,
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


def _content(text: str) -> WorkflowCommentContent:
    return WorkflowCommentContent(text)


def _mentions(*user_ids: str) -> WorkflowCommentMentions:
    return WorkflowCommentMentions(user_ids)


def _thread(*, mentioned_user_ids: tuple[str, ...] = (USER_A,), comment_id: str = "comment-1") -> WorkflowCommentAgg:
    comment = WorkflowCommentAgg.start(
        comment_id=comment_id,
        workspace_id="workspace-1",
        app_id="app-1",
        actor_id=CREATOR,
        content=_content("hello"),
        position_x=1.0,
        position_y=2.0,
        mentions=_mentions(*mentioned_user_ids),
        now=STARTED_AT,
    )
    comment.pull_events()
    return comment


def _with_reply(*, created_by: str = OTHER, mentioned_user_ids: tuple[str, ...] = (USER_A,)) -> WorkflowCommentAgg:
    comment = _thread()
    comment.add_reply(
        reply_id="reply-1",
        actor_id=created_by,
        content=_content("reply"),
        mentions=_mentions(*mentioned_user_ids),
        now=STARTED_AT,
    )
    comment.pull_events()
    return comment


def _edit(comment: WorkflowCommentAgg, *, actor_id: str = CREATOR, mentions: WorkflowCommentMentions | None) -> None:
    comment.edit(
        actor_id=actor_id, content=_content("hello"), position_x=None, position_y=None, mentions=mentions, now=NOW
    )


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("   ", "Comment content cannot be empty"),
        ("a" * (MAX_COMMENT_CONTENT_LENGTH + 1), "Comment content cannot exceed 1000 characters"),
    ],
    ids=["blank", "too-long"],
)
def test_content_rejects_blank_and_too_long_text(text: str, message: str) -> None:
    with pytest.raises(InvalidWorkflowCommentContentError, match=message):
        WorkflowCommentContent(text)


def test_content_at_the_length_limit_is_accepted() -> None:
    text = "a" * MAX_COMMENT_CONTENT_LENGTH

    assert WorkflowCommentContent(text).text == text


def test_mentions_parse_skips_empty_ids_and_keeps_each_once_in_order() -> None:
    assert WorkflowCommentMentions.parse((USER_B, "", USER_A, USER_B)).user_ids == (USER_B, USER_A)


def test_mentions_reject_malformed_ids() -> None:
    with pytest.raises(InvalidMentionedUserIdError, match="not-a-uuid is not a valid uuid."):
        WorkflowCommentMentions.parse((USER_A, "not-a-uuid"))


def test_mentions_among_members_keep_only_members_in_order() -> None:
    mentions = _mentions(USER_B, CREATOR, USER_A)

    assert mentions.among(frozenset({USER_A, USER_B})) == _mentions(USER_B, USER_A)


def test_value_objects_compare_by_value() -> None:
    assert WorkflowCommentContent("hi") == WorkflowCommentContent("hi")
    assert _mentions(USER_A) != _mentions(USER_B)


def test_start_opens_an_unresolved_thread_owned_by_the_actor() -> None:
    comment = WorkflowCommentAgg.start(
        comment_id="comment-1",
        workspace_id="workspace-1",
        app_id="app-1",
        actor_id=CREATOR,
        content=_content("hello"),
        position_x=1.0,
        position_y=2.0,
        mentions=_mentions(USER_B, CREATOR, USER_A),
        now=STARTED_AT,
    )

    assert (comment.id, comment.workspace_id, comment.app_id) == ("comment-1", "workspace-1", "app-1")
    assert (comment.content, comment.position_x, comment.position_y) == ("hello", 1.0, 2.0)
    assert (comment.created_by, comment.created_at, comment.updated_at) == (CREATOR, STARTED_AT, STARTED_AT)
    assert (comment.resolved, comment.resolved_at, comment.resolved_by) == (False, None, None)
    assert comment.mentioned_user_ids == (USER_B, CREATOR, USER_A)
    assert comment.replies == []
    # Everyone it mentions is notified except the actor.
    assert comment.pull_events() == (
        WorkflowCommentUsersMentioned(actor_id=CREATOR, user_ids=(USER_B, USER_A), content="hello"),
    )


def test_entities_compare_by_identity_whatever_their_state() -> None:
    comment = _thread()
    same_thread = _thread()
    same_thread.resolve(actor_id=OTHER, now=NOW)

    assert comment == same_thread
    assert hash(comment) == hash(same_thread)
    assert comment != _thread(comment_id="comment-2")
    reply = WorkflowCommentReply(
        id="reply-1", content="a", created_by=OTHER, created_at=NOW, updated_at=NOW, mentioned_user_ids=()
    )
    assert reply == WorkflowCommentReply(
        id="reply-1", content="b", created_by=CREATOR, created_at=NOW, updated_at=NOW, mentioned_user_ids=(USER_A,)
    )
    assert hash(reply) == hash("reply-1")
    assert reply != comment


def test_edit_changes_the_thread_in_place_and_keeps_omitted_positions_and_mentions() -> None:
    comment = _thread()

    comment.edit(
        actor_id=CREATOR, content=_content("updated"), position_x=10.5, position_y=None, mentions=None, now=NOW
    )

    assert (comment.content, comment.position_x, comment.position_y) == ("updated", 10.5, 2.0)
    assert comment.mentioned_user_ids == (USER_A,)
    assert (comment.created_at, comment.updated_at) == (STARTED_AT, NOW)
    assert comment.pull_events() == ()

    comment.edit(actor_id=CREATOR, content=_content("moved"), position_x=None, position_y=7.0, mentions=None, now=NOW)

    assert (comment.position_x, comment.position_y) == (10.5, 7.0)


def test_edit_replaces_the_comment_mentions_but_not_reply_mentions() -> None:
    comment = _with_reply()

    _edit(comment, mentions=_mentions())

    assert comment.mentioned_user_ids == ()
    assert comment.reply("reply-1").mentioned_user_ids == (USER_A,)


def test_only_the_comment_creator_edits_or_removes_it() -> None:
    comment = _thread()

    with pytest.raises(WorkflowCommentPermissionError, match="Only the comment creator can update it"):
        _edit(comment, actor_id=OTHER, mentions=_mentions(USER_B))
    with pytest.raises(WorkflowCommentPermissionError, match="Only the comment creator can delete it"):
        comment.ensure_removable_by(OTHER)
    comment.ensure_removable_by(CREATOR)
    # A refused edit leaves the thread and its events as they were.
    assert (comment.updated_at, comment.mentioned_user_ids) == (STARTED_AT, (USER_A,))
    assert comment.pull_events() == ()


def test_any_member_resolves_and_the_first_resolution_is_kept() -> None:
    comment = _thread()

    comment.resolve(actor_id=OTHER, now=NOW)
    comment.resolve(actor_id=CREATOR, now=NOW + datetime.timedelta(hours=1))

    assert (comment.resolved, comment.resolved_at, comment.resolved_by) == (True, NOW, OTHER)
    assert comment.updated_at == NOW
    assert comment.pull_events() == ()


def test_add_reply_appends_a_reply_owned_by_the_actor() -> None:
    comment = _with_reply()

    comment.add_reply(
        reply_id="reply-2", actor_id=CREATOR, content=_content("again"), mentions=_mentions(USER_B), now=NOW
    )

    assert [reply.id for reply in comment.replies] == ["reply-1", "reply-2"]
    reply = comment.reply("reply-2")
    assert (reply.content, reply.created_by, reply.created_at, reply.updated_at) == ("again", CREATOR, NOW, NOW)
    assert reply.mentioned_user_ids == (USER_B,)
    # Adding a reply does not touch the comment itself.
    assert comment.updated_at == STARTED_AT


def test_edit_reply_replaces_content_and_mentions_of_that_reply_only() -> None:
    comment = _with_reply()
    comment.add_reply(
        reply_id="reply-2", actor_id=CREATOR, content=_content("again"), mentions=_mentions(), now=STARTED_AT
    )

    comment.edit_reply(reply_id="reply-1", actor_id=OTHER, content=_content("new"), mentions=_mentions(USER_B), now=NOW)

    reply = comment.reply("reply-1")
    assert (reply.content, reply.mentioned_user_ids, reply.updated_at) == ("new", (USER_B,), NOW)
    other_reply = comment.reply("reply-2")
    assert (other_reply.content, other_reply.updated_at) == ("again", STARTED_AT)


def test_only_the_reply_creator_edits_or_removes_it() -> None:
    comment = _with_reply(created_by=OTHER)

    with pytest.raises(WorkflowCommentPermissionError, match="Only the reply creator can update it"):
        comment.edit_reply(reply_id="reply-1", actor_id=CREATOR, content=_content("x"), mentions=_mentions(), now=NOW)
    with pytest.raises(WorkflowCommentPermissionError, match="Only the reply creator can delete it"):
        comment.remove_reply(reply_id="reply-1", actor_id=CREATOR)
    assert comment.reply("reply-1").content == "reply"


def test_remove_reply_drops_the_reply_with_its_mentions() -> None:
    comment = _with_reply()

    comment.remove_reply(reply_id="reply-1", actor_id=OTHER)

    assert comment.replies == []


type ReplyLookup = Callable[[WorkflowCommentAgg], object]


@pytest.mark.parametrize(
    "lookup",
    [
        lambda comment: comment.reply("missing"),
        lambda comment: comment.edit_reply(
            reply_id="missing", actor_id=OTHER, content=_content("x"), mentions=_mentions(), now=NOW
        ),
        lambda comment: comment.remove_reply(reply_id="missing", actor_id=OTHER),
    ],
)
def test_unknown_reply_is_not_found(lookup: ReplyLookup) -> None:
    with pytest.raises(WorkflowCommentReplyNotFoundError):
        lookup(_with_reply())


def test_an_edit_records_only_users_it_newly_mentions() -> None:
    comment = _thread(mentioned_user_ids=(USER_A,))

    _edit(comment, mentions=_mentions(USER_A, USER_B, CREATOR))

    assert comment.pull_events() == (
        WorkflowCommentUsersMentioned(actor_id=CREATOR, user_ids=(USER_B,), content="hello"),
    )


def test_reply_mentions_are_compared_with_the_same_reply_only() -> None:
    comment = _with_reply(mentioned_user_ids=(USER_B,))

    comment.add_reply(
        reply_id="reply-2", actor_id=OTHER, content=_content("again"), mentions=_mentions(USER_A, USER_B), now=NOW
    )
    comment.edit_reply(
        reply_id="reply-1", actor_id=OTHER, content=_content("reply"), mentions=_mentions(USER_B, USER_A), now=NOW
    )

    # USER_A is already mentioned on the comment and USER_B in the first reply; the new reply still notifies both.
    assert comment.pull_events() == (
        WorkflowCommentUsersMentioned(actor_id=OTHER, user_ids=(USER_A, USER_B), content="again"),
        WorkflowCommentUsersMentioned(actor_id=OTHER, user_ids=(USER_A,), content="reply"),
    )


def test_pulled_events_are_handed_out_once() -> None:
    comment = _thread(mentioned_user_ids=())

    _edit(comment, mentions=_mentions(USER_A))

    assert len(comment.pull_events()) == 1
    assert comment.pull_events() == ()
