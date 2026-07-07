from unittest.mock import Mock, patch

from models.comment import WorkflowComment, WorkflowCommentMention, WorkflowCommentReply


def test_workflow_comment_account_properties_and_cache() -> None:
    comment = WorkflowComment(
        created_by="user-1",
        resolved_by="user-2",
        content="hello",
        position_x=1,
        position_y=2,
        tenant_id="xxx",
        app_id="yyy",
    )
    created_account = Mock(id="user-1")
    resolved_account = Mock(id="user-2")

    with patch("models.comment.db.session.get", side_effect=[created_account, resolved_account]) as get_mock:
        assert comment.created_by_account is created_account
        assert comment.resolved_by_account is resolved_account
        assert get_mock.call_count == 2

    comment.cache_created_by_account(created_account)
    comment.cache_resolved_by_account(resolved_account)
    with patch("models.comment.db.session.get") as get_mock:
        assert comment.created_by_account is created_account
        assert comment.resolved_by_account is resolved_account
        get_mock.assert_not_called()

    comment_without_resolver = WorkflowComment(
        tenant_id="xxx",
        app_id="yyy",
        created_by="user-1",
        resolved_by=None,
        content="hello",
        position_x=1,
        position_y=2,
    )
    with patch("models.comment.db.session.get") as get_mock:
        assert comment_without_resolver.resolved_by_account is None
        get_mock.assert_not_called()


def test_workflow_comment_counts_and_participants() -> None:
    reply_1 = WorkflowCommentReply(comment_id="comment-1", content="reply-1", created_by="user-2")
    reply_2 = WorkflowCommentReply(comment_id="comment-1", content="reply-2", created_by="user-2")
    mention_1 = WorkflowCommentMention(comment_id="comment-1", mentioned_user_id="user-3")
    mention_2 = WorkflowCommentMention(comment_id="comment-1", mentioned_user_id="user-4")
    comment = WorkflowComment(
        created_by="user-1",
        resolved_by=None,
        content="hello",
        position_x=1,
        position_y=2,
        tenant_id="xxx",
        app_id="yyy",
    )
    comment.replies = [reply_1, reply_2]
    comment.mentions = [mention_1, mention_2]

    account_1 = Mock(id="user-1")
    account_2 = Mock(id="user-2")
    account_3 = Mock(id="user-3")
    account_map = {
        "user-1": account_1,
        "user-2": account_2,
        "user-3": account_3,
        "user-4": None,
    }

    with patch("models.comment.db.session.get", side_effect=lambda _model, user_id: account_map[user_id]) as get_mock:
        participants = comment.participants

    assert comment.reply_count == 2
    assert comment.mention_count == 2
    assert set(participants) == {account_1, account_2, account_3}
    assert get_mock.call_count == 4


def test_workflow_comment_participants_use_cached_accounts() -> None:
    reply = WorkflowCommentReply(comment_id="comment-1", content="reply-1", created_by="user-2")
    mention = WorkflowCommentMention(comment_id="comment-1", mentioned_user_id="user-3")
    comment = WorkflowComment(
        created_by="user-1",
        resolved_by=None,
        content="hello",
        position_x=1,
        position_y=2,
        tenant_id="xxx",
        app_id="yyy",
    )
    comment.replies = [reply]
    comment.mentions = [mention]

    account_1 = Mock(id="user-1")
    account_2 = Mock(id="user-2")
    account_3 = Mock(id="user-3")
    comment.cache_created_by_account(account_1)
    reply.cache_created_by_account(account_2)
    mention.cache_mentioned_user_account(account_3)

    with patch("models.comment.db.session.get") as get_mock:
        participants = comment.participants

    assert set(participants) == {account_1, account_2, account_3}
    get_mock.assert_not_called()


def test_reply_and_mention_account_properties_and_cache() -> None:
    reply = WorkflowCommentReply(comment_id="comment-1", content="reply", created_by="user-1")
    mention = WorkflowCommentMention(comment_id="comment-1", mentioned_user_id="user-2")
    reply_account = Mock(id="user-1")
    mention_account = Mock(id="user-2")

    with patch("models.comment.db.session.get", side_effect=[reply_account, mention_account]) as get_mock:
        assert reply.created_by_account is reply_account
        assert mention.mentioned_user_account is mention_account
        assert get_mock.call_count == 2

    reply.cache_created_by_account(reply_account)
    mention.cache_mentioned_user_account(mention_account)
    with patch("models.comment.db.session.get") as get_mock:
        assert reply.created_by_account is reply_account
        assert mention.mentioned_user_account is mention_account
        get_mock.assert_not_called()
