from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

import models.comment as comment_module
from models.account import Account
from models.comment import WorkflowComment, WorkflowCommentMention, WorkflowCommentReply


class _DatabaseBinding:
    """Expose a real SQLite session to model properties that use ``db.session``."""

    session: Session

    def __init__(self, session: Session) -> None:
        self.session = session


def _account(name: str) -> Account:
    account = Account(name=name, email=f"{name.lower()}@example.com")
    account.id = str(uuid4())
    return account


def _comment(created_by: str, resolved_by: str | None = None) -> WorkflowComment:
    return WorkflowComment(
        created_by=created_by,
        resolved_by=resolved_by,
        content="hello",
        position_x=1,
        position_y=2,
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
    )


COMMENT_MODELS = (Account, WorkflowComment, WorkflowCommentReply, WorkflowCommentMention)


@pytest.mark.parametrize("sqlite_session", [COMMENT_MODELS], indirect=True)
def test_workflow_comment_account_properties_and_cache(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    created_account = _account("Creator")
    resolved_account = _account("Resolver")
    comment = _comment(created_account.id, resolved_account.id)
    sqlite_session.add_all([created_account, resolved_account, comment])
    sqlite_session.commit()
    monkeypatch.setattr(comment_module, "db", _DatabaseBinding(sqlite_session))

    assert comment.created_by_account is created_account
    assert comment.resolved_by_account is resolved_account

    comment.cache_created_by_account(created_account)
    comment.cache_resolved_by_account(resolved_account)
    sqlite_session.delete(created_account)
    sqlite_session.delete(resolved_account)
    sqlite_session.commit()

    assert comment.created_by_account is created_account
    assert comment.resolved_by_account is resolved_account

    comment_without_resolver = _comment(str(uuid4()))
    sqlite_session.add(comment_without_resolver)
    sqlite_session.commit()
    assert comment_without_resolver.resolved_by_account is None


@pytest.mark.parametrize("sqlite_session", [COMMENT_MODELS], indirect=True)
def test_workflow_comment_counts_and_participants(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    account_1 = _account("Creator")
    account_2 = _account("Replier")
    account_3 = _account("Mentioned")
    missing_account_id = str(uuid4())
    comment = _comment(account_1.id)
    comment.replies = [
        WorkflowCommentReply(comment_id=comment.id, content="reply-1", created_by=account_2.id),
        WorkflowCommentReply(comment_id=comment.id, content="reply-2", created_by=account_2.id),
    ]
    comment.mentions = [
        WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=account_3.id),
        WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=missing_account_id),
    ]
    sqlite_session.add_all([account_1, account_2, account_3, comment])
    sqlite_session.commit()
    monkeypatch.setattr(comment_module, "db", _DatabaseBinding(sqlite_session))

    participants = comment.participants

    assert comment.reply_count == 2
    assert comment.mention_count == 2
    assert {account.id for account in participants} == {account_1.id, account_2.id, account_3.id}


@pytest.mark.parametrize("sqlite_session", [COMMENT_MODELS], indirect=True)
def test_workflow_comment_participants_use_cached_accounts(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    account_1 = _account("Creator")
    account_2 = _account("Replier")
    account_3 = _account("Mentioned")
    comment = _comment(account_1.id)
    reply = WorkflowCommentReply(comment_id=comment.id, content="reply-1", created_by=account_2.id)
    mention = WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=account_3.id)
    comment.replies = [reply]
    comment.mentions = [mention]
    sqlite_session.add_all([account_1, account_2, account_3, comment])
    sqlite_session.commit()
    monkeypatch.setattr(comment_module, "db", _DatabaseBinding(sqlite_session))

    comment.cache_created_by_account(account_1)
    reply.cache_created_by_account(account_2)
    mention.cache_mentioned_user_account(account_3)
    sqlite_session.delete(account_1)
    sqlite_session.delete(account_2)
    sqlite_session.delete(account_3)
    sqlite_session.commit()

    assert {account.id for account in comment.participants} == {account_1.id, account_2.id, account_3.id}


@pytest.mark.parametrize("sqlite_session", [COMMENT_MODELS], indirect=True)
def test_reply_and_mention_account_properties_and_cache(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    reply_account = _account("Replier")
    mention_account = _account("Mentioned")
    comment = _comment(reply_account.id)
    reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=reply_account.id)
    mention = WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=mention_account.id)
    comment.replies = [reply]
    comment.mentions = [mention]
    sqlite_session.add_all([reply_account, mention_account, comment])
    sqlite_session.commit()
    monkeypatch.setattr(comment_module, "db", _DatabaseBinding(sqlite_session))

    assert reply.created_by_account is reply_account
    assert mention.mentioned_user_account is mention_account

    reply.cache_created_by_account(reply_account)
    mention.cache_mentioned_user_account(mention_account)
    sqlite_session.delete(reply_account)
    sqlite_session.delete(mention_account)
    sqlite_session.commit()

    assert reply.created_by_account is reply_account
    assert mention.mentioned_user_account is mention_account
