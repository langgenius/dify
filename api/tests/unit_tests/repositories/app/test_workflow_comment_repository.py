"""Exercise workflow comment persistence with real short-lived Sessions."""

from datetime import datetime
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models import App, TenantAccountJoin, WorkflowComment, WorkflowCommentMention, WorkflowCommentReply
from models.account import Account, TenantAccountRole
from models.model import AppMode
from repositories.app.workflow_comment_repository import WorkflowCommentRepository
from services.app import workflow_comment_mention_gateway
from services.app.workflow_comment_mention_gateway import CeleryWorkflowCommentMentionNotifier
from services.app.workflow_comment_service import (
    MentionContext,
    MentionRecipient,
    WorkflowCommentDraft,
    WorkflowCommentEdit,
    WorkflowCommentNotFoundError,
    WorkflowCommentPermissionError,
    WorkflowCommentReplyDraft,
    WorkflowCommentReplyNotFoundError,
    WorkflowCommentService,
)
from tests.unit_tests.model_factories import make_account, make_app
from tests.unit_tests.repositories.app.console_visibility import UNADDRESSABLE_IN_WORKSPACE, MakeUnaddressable

TENANT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT_ID = "11111111-1111-1111-1111-111111111112"
APP_ID = "22222222-2222-2222-2222-222222222222"
OTHER_APP_ID = "22222222-2222-2222-2222-222222222223"
OWNER_ID = "33333333-3333-3333-3333-333333333333"
USER_2_ID = "33333333-3333-3333-3333-333333333334"
USER_3_ID = "33333333-3333-3333-3333-333333333335"
USER_4_ID = "33333333-3333-3333-3333-333333333336"
OUTSIDER_ID = "33333333-3333-3333-3333-333333333337"


@pytest.fixture
def delay_mock(monkeypatch: pytest.MonkeyPatch) -> Mock:
    """Stand in for the Celery broker at the mention email task boundary."""
    mock = Mock()
    monkeypatch.setattr(workflow_comment_mention_gateway.send_workflow_comment_mention_email_task, "delay", mock)
    return mock


@pytest.fixture
def comment_service(repository: WorkflowCommentRepository) -> WorkflowCommentService:
    """The production composition: real repository and Celery notifier, with only task delivery mocked."""
    return WorkflowCommentService(
        comments=repository,
        notifier=CeleryWorkflowCommentMentionNotifier(),
        console_web_url="https://console.example.com",
    )


def _context(account_id: str) -> RequestContext:
    return RequestContext(request_id="request", trace_id=None, account_id=account_id, active_workspace_id=TENANT_ID)


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> WorkflowCommentRepository:
    return WorkflowCommentRepository(session_factory=sqlite_session_factory)


def _account(
    account_id: str,
    *,
    name: str = "Test User",
    email: str = "user@example.com",
    interface_language: str | None = "en-US",
) -> Account:
    return make_account(account_id=account_id, name=name, email=email, interface_language=interface_language)


def _app(*, app_id: str = APP_ID, tenant_id: str = TENANT_ID, name: str = "My App") -> App:
    return make_app(
        app_id=app_id,
        tenant_id=tenant_id,
        name=name,
        mode=AppMode.WORKFLOW,
        icon_type=None,
        enable_site=False,
        enable_api=False,
        created_by=OWNER_ID,
    )


def _comment(
    *,
    tenant_id: str = TENANT_ID,
    app_id: str = APP_ID,
    created_by: str = OWNER_ID,
    content: str = "hello",
    resolved: bool = False,
    resolved_at: datetime | None = None,
    resolved_by: str | None = None,
) -> WorkflowComment:
    return WorkflowComment(
        tenant_id=tenant_id,
        app_id=app_id,
        position_x=1.0,
        position_y=2.0,
        content=content,
        created_by=created_by,
        resolved=resolved,
        resolved_at=resolved_at,
        resolved_by=resolved_by,
    )


def _membership(account_id: str, *, tenant_id: str = TENANT_ID) -> TenantAccountJoin:
    return TenantAccountJoin(tenant_id=tenant_id, account_id=account_id, role=TenantAccountRole.NORMAL)


def _persist(session: Session, *objects: object) -> None:
    session.add_all(objects)
    session.commit()


def _mention_user_ids(session: Session, comment_id: str, *, reply_id: str | None = None) -> list[str]:
    stmt = select(WorkflowCommentMention.mentioned_user_id).where(WorkflowCommentMention.comment_id == comment_id)
    stmt = stmt.where(
        WorkflowCommentMention.reply_id.is_(None) if reply_id is None else WorkflowCommentMention.reply_id == reply_id
    )
    return list(session.scalars(stmt).all())


def test_app_exists_is_scoped_to_workspace(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    _persist(sqlite_session, _app())

    assert repository.app_exists(workspace_id=TENANT_ID, app_id=APP_ID)
    assert not repository.app_exists(workspace_id=OTHER_TENANT_ID, app_id=APP_ID)
    assert not repository.app_exists(workspace_id=TENANT_ID, app_id=OTHER_APP_ID)


@pytest.mark.parametrize("make_unaddressable", UNADDRESSABLE_IN_WORKSPACE)
def test_app_exists_hides_unaddressable_apps(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    repository: WorkflowCommentRepository,
    make_unaddressable: MakeUnaddressable,
) -> None:
    _persist(sqlite_session, _app())
    with sqlite_session_factory.begin() as session:
        make_unaddressable(session, APP_ID)

    assert not repository.app_exists(workspace_id=TENANT_ID, app_id=APP_ID)


def test_list_comments_resolves_accounts_and_participants(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment(resolved=True, resolved_by=USER_2_ID)
    other_app_comment = _comment(app_id=OTHER_APP_ID)
    _persist(
        sqlite_session,
        _account(OWNER_ID, name="Owner"),
        _account(USER_2_ID, name="Resolver"),
        _account(USER_3_ID, name="Replier"),
        _account(USER_4_ID, name="Mentioned"),
        comment,
        other_app_comment,
    )
    _persist(
        sqlite_session,
        WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=USER_3_ID),
        WorkflowCommentReply(comment_id=comment.id, content="again", created_by=OWNER_ID),
        WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_4_ID),
        WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=OUTSIDER_ID),
    )

    [summary] = repository.list_comments(workspace_id=TENANT_ID, app_id=APP_ID)

    assert summary.id == comment.id
    assert summary.created_by_account is not None
    assert summary.created_by_account.name == "Owner"
    assert summary.resolved_by_account is not None
    assert summary.resolved_by_account.name == "Resolver"
    assert summary.reply_count == 2
    assert summary.mention_count == 2
    # Creator, repliers, then mentioned users, each once; accounts that no longer exist are skipped.
    assert [participant.id for participant in summary.participants] == [OWNER_ID, USER_3_ID, USER_4_ID]


def test_list_comments_orders_newest_first(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    older = _comment(content="older")
    newer = _comment(content="newer")
    _persist(sqlite_session, older, newer)
    older.created_at = datetime(2024, 1, 1)
    newer.created_at = datetime(2024, 1, 2)
    sqlite_session.commit()

    comments = repository.list_comments(workspace_id=TENANT_ID, app_id=APP_ID)

    assert [comment.content for comment in comments] == ["newer", "older"]


def test_get_comment_returns_thread_with_accounts(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(sqlite_session, _account(OWNER_ID, name="Owner"), _account(USER_2_ID, name="Replier"), comment)
    reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=USER_2_ID)
    _persist(sqlite_session, reply)
    _persist(
        sqlite_session,
        WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=OWNER_ID),
    )

    detail = repository.get_comment(workspace_id=TENANT_ID, app_id=APP_ID, comment_id=comment.id)

    assert detail.created_by_account is not None
    assert detail.created_by_account.id == OWNER_ID
    assert detail.resolved_by_account is None
    [reply_record] = detail.replies
    assert reply_record.content == "reply"
    assert reply_record.created_by_account is not None
    assert reply_record.created_by_account.name == "Replier"
    [mention_record] = detail.mentions
    assert mention_record.reply_id == reply.id
    assert mention_record.mentioned_user_account is not None
    assert mention_record.mentioned_user_account.id == OWNER_ID


@pytest.mark.parametrize(
    ("workspace_id", "app_id"),
    [(OTHER_TENANT_ID, APP_ID), (TENANT_ID, OTHER_APP_ID)],
    ids=["other-workspace", "other-app"],
)
def test_get_comment_is_scoped_to_workspace_and_app(
    sqlite_session: Session, repository: WorkflowCommentRepository, workspace_id: str, app_id: str
) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)

    with pytest.raises(WorkflowCommentNotFoundError):
        repository.get_comment(workspace_id=workspace_id, app_id=app_id, comment_id=comment.id)


def test_insert_comment_keeps_only_workspace_member_mentions(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    _persist(
        sqlite_session,
        _app(name="Canvas"),
        _account(OWNER_ID, name="Owner"),
        _account(USER_2_ID, name="Member", email="member@example.com", interface_language="ja-JP"),
        _account(USER_3_ID, name="Outsider", email="outsider@example.com"),
        _membership(OWNER_ID),
        _membership(USER_2_ID),
        _membership(USER_3_ID, tenant_id=OTHER_TENANT_ID),
    )

    write = repository.insert_comment(
        workspace_id=TENANT_ID,
        app_id=APP_ID,
        actor_id=OWNER_ID,
        draft=WorkflowCommentDraft(
            content="hello", position_x=1.0, position_y=2.0, mentioned_user_ids=(OWNER_ID, USER_3_ID, USER_2_ID)
        ),
    )

    comment = sqlite_session.get_one(WorkflowComment, write.result.id)
    assert comment.content == "hello"
    assert comment.created_at == write.result.created_at
    # The actor's self-mention is stored but never notified.
    assert _mention_user_ids(sqlite_session, comment.id) == [OWNER_ID, USER_2_ID]
    assert write.mentions == MentionContext(
        app_name="Canvas",
        commenter_name="Owner",
        recipients=(MentionRecipient(email="member@example.com", name="Member", interface_language="ja-JP"),),
    )


def test_insert_comment_skips_recipients_without_email(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    _persist(
        sqlite_session,
        _app(),
        _account(OWNER_ID),
        _account(USER_2_ID, email=""),
        _membership(USER_2_ID),
    )

    write = repository.insert_comment(
        workspace_id=TENANT_ID,
        app_id=APP_ID,
        actor_id=OWNER_ID,
        draft=WorkflowCommentDraft(content="hello", position_x=0, position_y=0, mentioned_user_ids=(USER_2_ID,)),
    )

    assert _mention_user_ids(sqlite_session, write.result.id) == [USER_2_ID]
    assert write.mentions.recipients == ()


def test_update_comment_raises_not_found(repository: WorkflowCommentRepository) -> None:
    with pytest.raises(WorkflowCommentNotFoundError):
        repository.update_comment(
            workspace_id=TENANT_ID,
            app_id=APP_ID,
            comment_id="missing",
            actor_id=OWNER_ID,
            edit=WorkflowCommentEdit(content="x", position_x=None, position_y=None, mentioned_user_ids=None),
        )


def test_update_comment_rejects_non_creator(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment(created_by=OWNER_ID)
    _persist(sqlite_session, comment)

    with pytest.raises(WorkflowCommentPermissionError, match="Only the comment creator can update it"):
        repository.update_comment(
            workspace_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            actor_id=OUTSIDER_ID,
            edit=WorkflowCommentEdit(content="x", position_x=None, position_y=None, mentioned_user_ids=None),
        )


def test_update_comment_replaces_mentions_and_reports_only_new_ones(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(
        sqlite_session,
        _app(),
        _account(OWNER_ID, name="Owner"),
        _account(USER_2_ID, name="Existing", email="existing@example.com"),
        _account(USER_3_ID, name="New User", email="new@example.com"),
        _account(USER_4_ID, name="Dropped", email="dropped@example.com"),
        _membership(USER_2_ID),
        _membership(USER_3_ID),
        _membership(USER_4_ID),
        comment,
    )
    _persist(
        sqlite_session,
        WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID),
        WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_4_ID),
    )

    write = repository.update_comment(
        workspace_id=TENANT_ID,
        app_id=APP_ID,
        comment_id=comment.id,
        actor_id=OWNER_ID,
        edit=WorkflowCommentEdit(
            content="updated", position_x=10.5, position_y=None, mentioned_user_ids=(USER_2_ID, USER_3_ID)
        ),
    )

    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(WorkflowComment, comment.id)
    assert persisted.content == "updated"
    assert persisted.position_x == 10.5
    assert persisted.position_y == 2.0
    assert write.result.updated_at == persisted.updated_at
    assert sorted(_mention_user_ids(sqlite_session, comment.id)) == [USER_2_ID, USER_3_ID]
    assert [recipient.email for recipient in write.mentions.recipients] == ["new@example.com"]


def test_update_comment_keeps_mentions_when_list_omitted(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    _persist(sqlite_session, WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID))

    write = repository.update_comment(
        workspace_id=TENANT_ID,
        app_id=APP_ID,
        comment_id=comment.id,
        actor_id=OWNER_ID,
        edit=WorkflowCommentEdit(content="updated", position_x=None, position_y=None, mentioned_user_ids=None),
    )

    assert _mention_user_ids(sqlite_session, comment.id) == [USER_2_ID]
    assert write.mentions.recipients == ()


def test_update_comment_clears_mentions_with_empty_list(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=USER_2_ID)
    _persist(sqlite_session, reply)
    _persist(
        sqlite_session,
        WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID),
        WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=USER_3_ID),
    )

    repository.update_comment(
        workspace_id=TENANT_ID,
        app_id=APP_ID,
        comment_id=comment.id,
        actor_id=OWNER_ID,
        edit=WorkflowCommentEdit(content="updated", position_x=None, position_y=None, mentioned_user_ids=()),
    )

    assert _mention_user_ids(sqlite_session, comment.id) == []
    # Reply mentions belong to the reply and survive a comment mention update.
    assert _mention_user_ids(sqlite_session, comment.id, reply_id=reply.id) == [USER_3_ID]


def test_delete_comment_rejects_non_creator(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment(created_by=OWNER_ID)
    _persist(sqlite_session, comment)

    with pytest.raises(WorkflowCommentPermissionError, match="Only the comment creator can delete it"):
        repository.delete_comment(workspace_id=TENANT_ID, app_id=APP_ID, comment_id=comment.id, actor_id=OUTSIDER_ID)

    assert sqlite_session.get(WorkflowComment, comment.id) is not None


def test_delete_comment_removes_replies_and_mentions(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=OWNER_ID)
    _persist(sqlite_session, reply)
    _persist(
        sqlite_session,
        WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID),
        WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=USER_3_ID),
    )
    comment_id = comment.id

    repository.delete_comment(workspace_id=TENANT_ID, app_id=APP_ID, comment_id=comment_id, actor_id=OWNER_ID)

    sqlite_session.expire_all()
    assert sqlite_session.get(WorkflowComment, comment_id) is None
    assert sqlite_session.scalar(select(func.count(WorkflowCommentReply.id))) == 0
    assert sqlite_session.scalar(select(func.count(WorkflowCommentMention.id))) == 0


def test_resolve_comment_sets_fields(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    now = datetime(2024, 1, 1, 12, 0, 0)

    with patch("repositories.app.workflow_comment_repository.naive_utc_now", return_value=now):
        result = repository.resolve_comment(
            workspace_id=TENANT_ID, app_id=APP_ID, comment_id=comment.id, actor_id=USER_2_ID
        )

    assert (result.resolved, result.resolved_at, result.resolved_by) == (True, now, USER_2_ID)
    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(WorkflowComment, comment.id)
    assert (persisted.resolved, persisted.resolved_at, persisted.resolved_by) == (True, now, USER_2_ID)


def test_resolve_comment_keeps_an_existing_resolution(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    resolved_at = datetime(2024, 1, 1, 10, 0, 0)
    comment = _comment(resolved=True, resolved_at=resolved_at, resolved_by=USER_2_ID)
    _persist(sqlite_session, comment)

    result = repository.resolve_comment(workspace_id=TENANT_ID, app_id=APP_ID, comment_id=comment.id, actor_id=OWNER_ID)

    assert (result.resolved_at, result.resolved_by) == (resolved_at, USER_2_ID)


def test_insert_reply_requires_comment_in_scope(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment(app_id=OTHER_APP_ID)
    _persist(sqlite_session, comment)

    with pytest.raises(WorkflowCommentNotFoundError):
        repository.insert_reply(
            workspace_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            actor_id=OWNER_ID,
            draft=WorkflowCommentReplyDraft(content="hello", mentioned_user_ids=()),
        )


def test_insert_reply_creates_reply_mentions(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment()
    _persist(
        sqlite_session,
        _app(),
        _account(OWNER_ID),
        _account(USER_2_ID, email="member@example.com"),
        _membership(USER_2_ID),
        comment,
    )

    write = repository.insert_reply(
        workspace_id=TENANT_ID,
        app_id=APP_ID,
        comment_id=comment.id,
        actor_id=OWNER_ID,
        draft=WorkflowCommentReplyDraft(content="hello", mentioned_user_ids=(USER_2_ID, OUTSIDER_ID)),
    )

    reply = sqlite_session.get_one(WorkflowCommentReply, write.result.id)
    assert reply.content == "hello"
    assert reply.created_at == write.result.created_at
    assert _mention_user_ids(sqlite_session, comment.id, reply_id=reply.id) == [USER_2_ID]
    assert [recipient.email for recipient in write.mentions.recipients] == ["member@example.com"]


def test_update_reply_reports_missing_comment_before_missing_reply(repository: WorkflowCommentRepository) -> None:
    with pytest.raises(WorkflowCommentNotFoundError):
        repository.update_reply(
            workspace_id=TENANT_ID,
            app_id=APP_ID,
            comment_id="missing-comment",
            reply_id="missing-reply",
            actor_id=OWNER_ID,
            draft=WorkflowCommentReplyDraft(content="x", mentioned_user_ids=()),
        )


def test_update_reply_raises_not_found_for_reply_in_another_thread(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    other_comment = _comment()
    _persist(sqlite_session, comment, other_comment)
    reply = WorkflowCommentReply(comment_id=other_comment.id, content="reply", created_by=OWNER_ID)
    _persist(sqlite_session, reply)

    with pytest.raises(WorkflowCommentReplyNotFoundError):
        repository.update_reply(
            workspace_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            reply_id=reply.id,
            actor_id=OWNER_ID,
            draft=WorkflowCommentReplyDraft(content="x", mentioned_user_ids=()),
        )

    sqlite_session.expire_all()
    assert sqlite_session.get_one(WorkflowCommentReply, reply.id).content == "reply"


def test_update_reply_rejects_non_creator(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=OWNER_ID)
    _persist(sqlite_session, reply)

    with pytest.raises(WorkflowCommentPermissionError, match="Only the reply creator can update it"):
        repository.update_reply(
            workspace_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            reply_id=reply.id,
            actor_id=OUTSIDER_ID,
            draft=WorkflowCommentReplyDraft(content="x", mentioned_user_ids=()),
        )


def test_update_reply_replaces_mentions_and_reports_only_new_ones(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(
        sqlite_session,
        _app(),
        _account(OWNER_ID),
        _account(USER_2_ID, email="existing@example.com"),
        _account(USER_3_ID, email="new@example.com"),
        _membership(USER_2_ID),
        _membership(USER_3_ID),
        comment,
    )
    reply = WorkflowCommentReply(comment_id=comment.id, content="old", created_by=OWNER_ID)
    _persist(sqlite_session, reply)
    _persist(
        sqlite_session,
        WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=USER_2_ID),
    )

    write = repository.update_reply(
        workspace_id=TENANT_ID,
        app_id=APP_ID,
        comment_id=comment.id,
        reply_id=reply.id,
        actor_id=OWNER_ID,
        draft=WorkflowCommentReplyDraft(content="new", mentioned_user_ids=(USER_2_ID, USER_3_ID)),
    )

    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(WorkflowCommentReply, reply.id)
    assert persisted.content == "new"
    assert write.result.updated_at == persisted.updated_at
    assert sorted(_mention_user_ids(sqlite_session, comment.id, reply_id=reply.id)) == [USER_2_ID, USER_3_ID]
    assert [recipient.email for recipient in write.mentions.recipients] == ["new@example.com"]


def test_delete_reply_rejects_non_creator(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=OWNER_ID)
    _persist(sqlite_session, reply)

    with pytest.raises(WorkflowCommentPermissionError, match="Only the reply creator can delete it"):
        repository.delete_reply(
            workspace_id=TENANT_ID, app_id=APP_ID, comment_id=comment.id, reply_id=reply.id, actor_id=OUTSIDER_ID
        )


def test_delete_reply_raises_not_found(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)

    with pytest.raises(WorkflowCommentReplyNotFoundError):
        repository.delete_reply(
            workspace_id=TENANT_ID, app_id=APP_ID, comment_id=comment.id, reply_id="missing", actor_id=OWNER_ID
        )


def test_delete_reply_removes_its_mentions(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=OWNER_ID)
    _persist(sqlite_session, reply)
    _persist(
        sqlite_session,
        WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID),
        WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=USER_3_ID),
    )
    reply_id = reply.id

    repository.delete_reply(
        workspace_id=TENANT_ID, app_id=APP_ID, comment_id=comment.id, reply_id=reply_id, actor_id=OWNER_ID
    )

    sqlite_session.expire_all()
    assert sqlite_session.get(WorkflowCommentReply, reply_id) is None
    assert _mention_user_ids(sqlite_session, comment.id, reply_id=reply_id) == []
    assert _mention_user_ids(sqlite_session, comment.id) == [USER_2_ID]


def test_update_comment_enqueues_mention_email_only_for_new_mentions(
    sqlite_session: Session, comment_service: WorkflowCommentService, delay_mock: Mock
) -> None:
    comment = _comment()
    _persist(
        sqlite_session,
        _app(name="Canvas"),
        _account(OWNER_ID, name="Owner", email="owner@example.com"),
        _account(USER_2_ID, name="Existing", email="existing@example.com"),
        _account(USER_3_ID, name="New User", email="new@example.com", interface_language="zh-Hans"),
        _membership(USER_2_ID),
        _membership(USER_3_ID),
        comment,
    )
    _persist(sqlite_session, WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID))

    comment_service.update_comment(
        _context(OWNER_ID),
        APP_ID,
        comment.id,
        WorkflowCommentEdit(
            content="updated", position_x=None, position_y=None, mentioned_user_ids=(USER_2_ID, USER_3_ID)
        ),
    )

    delay_mock.assert_called_once_with(
        language="zh-Hans",
        to="new@example.com",
        mentioned_name="New User",
        commenter_name="Owner",
        app_name="Canvas",
        comment_content="updated",
        app_url=f"https://console.example.com/app/{APP_ID}/workflow",
    )
    assert sorted(_mention_user_ids(sqlite_session, comment.id)) == [USER_2_ID, USER_3_ID]


def test_update_comment_without_mention_list_enqueues_nothing(
    sqlite_session: Session, comment_service: WorkflowCommentService, delay_mock: Mock
) -> None:
    comment = _comment()
    _persist(sqlite_session, _app(), _account(USER_2_ID, email="existing@example.com"), _membership(USER_2_ID), comment)
    _persist(sqlite_session, WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID))

    comment_service.update_comment(
        _context(OWNER_ID),
        APP_ID,
        comment.id,
        WorkflowCommentEdit(content="updated", position_x=None, position_y=None, mentioned_user_ids=None),
    )

    delay_mock.assert_not_called()


def test_create_comment_and_reply_enqueue_mention_emails_after_commit(
    sqlite_session: Session, comment_service: WorkflowCommentService, delay_mock: Mock
) -> None:
    _persist(
        sqlite_session,
        _app(),
        _account(OWNER_ID, name="Owner"),
        _account(USER_2_ID, name="Member", email="member@example.com"),
        _membership(OWNER_ID),
        _membership(USER_2_ID),
    )

    def committed_mentions(**_kwargs: str) -> None:
        # The email is enqueued only once the mention row is visible to other sessions.
        with Session(sqlite_session.get_bind()) as other_session:
            assert (other_session.scalar(select(func.count(WorkflowCommentMention.id))) or 0) > 0

    delay_mock.side_effect = committed_mentions

    created = comment_service.create_comment(
        _context(OWNER_ID),
        APP_ID,
        WorkflowCommentDraft(content="hello", position_x=0, position_y=0, mentioned_user_ids=(OWNER_ID, USER_2_ID)),
    )
    comment_service.create_reply(
        _context(OWNER_ID),
        APP_ID,
        created.id,
        WorkflowCommentReplyDraft(content="reply", mentioned_user_ids=(USER_2_ID,)),
    )

    # The self-mention is stored but never emailed.
    assert [call.kwargs["to"] for call in delay_mock.call_args_list] == ["member@example.com", "member@example.com"]
    assert [call.kwargs["comment_content"] for call in delay_mock.call_args_list] == ["hello", "reply"]


def test_update_reply_enqueues_mention_email_only_for_new_mentions(
    sqlite_session: Session, comment_service: WorkflowCommentService, delay_mock: Mock
) -> None:
    comment = _comment()
    _persist(
        sqlite_session,
        _app(),
        _account(OWNER_ID),
        _account(USER_2_ID, email="existing@example.com"),
        _account(USER_3_ID, email="new@example.com"),
        _membership(USER_2_ID),
        _membership(USER_3_ID),
        comment,
    )
    reply = WorkflowCommentReply(comment_id=comment.id, content="old", created_by=OWNER_ID)
    _persist(sqlite_session, reply)
    _persist(
        sqlite_session,
        WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=USER_2_ID),
    )

    comment_service.update_reply(
        _context(OWNER_ID),
        APP_ID,
        comment.id,
        reply.id,
        WorkflowCommentReplyDraft(content="new", mentioned_user_ids=(USER_2_ID, USER_3_ID)),
    )

    assert [call.kwargs["to"] for call in delay_mock.call_args_list] == ["new@example.com"]
