"""Exercise workflow comment persistence with real short-lived Sessions."""

from dataclasses import replace
from datetime import datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models import App, TenantAccountJoin, WorkflowComment, WorkflowCommentMention, WorkflowCommentReply
from models.account import Account, TenantAccountRole
from models.model import AppMode
from repositories.app.workflow_comment_repository import WorkflowCommentRepository
from services.app import workflow_comment_mention_gateway
from services.app.workflow_comment_agg import WorkflowCommentAgg
from services.app.workflow_comment_errors import (
    WorkflowCommentNotFoundError,
    WorkflowCommentPermissionError,
    WorkflowCommentReplyNotFoundError,
)
from services.app.workflow_comment_mention_gateway import CeleryWorkflowCommentMentionNotifier
from services.app.workflow_comment_service import (
    MentionContext,
    MentionRecipient,
    WorkflowCommentDraft,
    WorkflowCommentEdit,
    WorkflowCommentReplyDraft,
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
NOW = datetime(2024, 1, 2, 12, 0, 0)


class EnqueuedEmails:
    """Records mention emails at the Celery task boundary instead of reaching a broker."""

    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def __call__(self, **kwargs: str) -> None:
        self.calls.append(kwargs)


@pytest.fixture
def enqueued(monkeypatch: pytest.MonkeyPatch) -> EnqueuedEmails:
    emails = EnqueuedEmails()
    monkeypatch.setattr(workflow_comment_mention_gateway.send_workflow_comment_mention_email_task, "delay", emails)
    return emails


@pytest.fixture
def comment_service(repository: WorkflowCommentRepository) -> WorkflowCommentService:
    """The production composition: real repository and Celery notifier, with only task delivery recorded."""
    return WorkflowCommentService(
        comments=repository,
        notifier=CeleryWorkflowCommentMentionNotifier(),
        console_web_url="https://console.example.com",
        now=lambda: NOW,
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


def _load(repository: WorkflowCommentRepository, comment_id: str) -> WorkflowCommentAgg:
    return repository.load_comment(workspace_id=TENANT_ID, app_id=APP_ID, comment_id=comment_id)


def _started(*, mentioned_user_ids: tuple[str, ...]) -> WorkflowCommentAgg:
    return WorkflowCommentAgg.start(
        comment_id="44444444-4444-4444-4444-444444444444",
        workspace_id=TENANT_ID,
        app_id=APP_ID,
        actor_id=OWNER_ID,
        content="hello",
        position_x=1.0,
        position_y=2.0,
        mentioned_user_ids=mentioned_user_ids,
        now=NOW,
    )


def _save(
    repository: WorkflowCommentRepository, loaded: WorkflowCommentAgg, changed: WorkflowCommentAgg
) -> MentionContext:
    return repository.save_comment(
        loaded=loaded,
        changed=changed,
        actor_id=OWNER_ID,
        notify_user_ids=changed.mentions_to_notify(before=loaded, actor_id=OWNER_ID),
    )


def _edit(
    comment: WorkflowCommentAgg, *, content: str, mentioned_user_ids: tuple[str, ...] | None
) -> WorkflowCommentAgg:
    return comment.edit(
        actor_id=OWNER_ID,
        content=content,
        position_x=None,
        position_y=None,
        mentioned_user_ids=mentioned_user_ids,
        now=NOW,
    )


def _mention_row_ids(session: Session, comment_id: str) -> list[str]:
    session.expire_all()
    return list(
        session.scalars(select(WorkflowCommentMention.id).where(WorkflowCommentMention.comment_id == comment_id)).all()
    )


def test_load_comment_keeps_reply_mentions_with_their_reply(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment(resolved=True, resolved_at=datetime(2024, 1, 1, 9, 0, 0), resolved_by=USER_2_ID)
    _persist(sqlite_session, comment)
    reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=USER_2_ID)
    _persist(sqlite_session, reply)
    _persist(
        sqlite_session,
        WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID),
        WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=USER_3_ID),
    )

    loaded = _load(repository, comment.id)

    assert (loaded.workspace_id, loaded.app_id, loaded.created_by) == (TENANT_ID, APP_ID, OWNER_ID)
    assert (loaded.content, loaded.position_x, loaded.position_y) == ("hello", 1.0, 2.0)
    assert (loaded.created_at, loaded.updated_at) == (comment.created_at, comment.updated_at)
    assert (loaded.resolved, loaded.resolved_at, loaded.resolved_by) == (True, datetime(2024, 1, 1, 9, 0, 0), USER_2_ID)
    assert loaded.mentioned_user_ids == (USER_2_ID,)
    [loaded_reply] = loaded.replies
    assert (loaded_reply.id, loaded_reply.content, loaded_reply.created_by) == (reply.id, "reply", USER_2_ID)
    assert (loaded_reply.created_at, loaded_reply.updated_at) == (reply.created_at, reply.updated_at)
    assert loaded_reply.mentioned_user_ids == (USER_3_ID,)


@pytest.mark.parametrize(
    ("workspace_id", "app_id"),
    [(OTHER_TENANT_ID, APP_ID), (TENANT_ID, OTHER_APP_ID)],
    ids=["other-workspace", "other-app"],
)
def test_load_comment_is_scoped_to_workspace_and_app(
    sqlite_session: Session, repository: WorkflowCommentRepository, workspace_id: str, app_id: str
) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)

    with pytest.raises(WorkflowCommentNotFoundError):
        repository.load_comment(workspace_id=workspace_id, app_id=app_id, comment_id=comment.id)


def test_add_comment_keeps_only_workspace_member_mentions(
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
    comment = _started(mentioned_user_ids=(OWNER_ID, USER_3_ID, USER_2_ID))

    mentions = repository.add_comment(
        comment=comment, notify_user_ids=comment.mentions_to_notify(before=None, actor_id=OWNER_ID)
    )

    persisted = sqlite_session.get_one(WorkflowComment, comment.id)
    assert (persisted.tenant_id, persisted.app_id, persisted.created_by) == (TENANT_ID, APP_ID, OWNER_ID)
    assert (persisted.content, persisted.created_at, persisted.updated_at) == ("hello", NOW, NOW)
    assert persisted.resolved is False
    # The actor's self-mention is stored but never notified.
    assert _mention_user_ids(sqlite_session, comment.id) == [OWNER_ID, USER_2_ID]
    assert mentions == MentionContext(
        app_name="Canvas",
        commenter_name="Owner",
        recipients=(MentionRecipient(email="member@example.com", name="Member", interface_language="ja-JP"),),
    )


def test_add_comment_skips_recipients_without_email(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    _persist(
        sqlite_session,
        _app(),
        _account(OWNER_ID),
        _account(USER_2_ID, email=""),
        _membership(USER_2_ID),
    )
    comment = _started(mentioned_user_ids=(USER_2_ID,))

    mentions = repository.add_comment(comment=comment, notify_user_ids=(USER_2_ID,))

    assert _mention_user_ids(sqlite_session, comment.id) == [USER_2_ID]
    assert mentions.recipients == ()


def test_save_comment_writes_the_edit_and_reports_only_new_mentions(
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
    loaded = _load(repository, comment.id)
    changed = loaded.edit(
        actor_id=OWNER_ID,
        content="updated",
        position_x=10.5,
        position_y=None,
        mentioned_user_ids=(USER_2_ID, USER_3_ID, OUTSIDER_ID),
        now=NOW,
    )

    mentions = _save(repository, loaded, changed)

    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(WorkflowComment, comment.id)
    assert (persisted.content, persisted.position_x, persisted.position_y) == ("updated", 10.5, 2.0)
    assert persisted.updated_at == NOW
    assert _mention_user_ids(sqlite_session, comment.id) == [USER_2_ID, USER_3_ID]
    assert [recipient.email for recipient in mentions.recipients] == ["new@example.com"]


def test_save_comment_leaves_untouched_mentions_unwritten(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    _persist(sqlite_session, WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID))
    mention_ids = _mention_row_ids(sqlite_session, comment.id)
    loaded = _load(repository, comment.id)

    mentions = _save(repository, loaded, _edit(loaded, content="updated", mentioned_user_ids=None))

    assert _mention_row_ids(sqlite_session, comment.id) == mention_ids
    assert mentions.recipients == ()


def test_save_comment_clearing_comment_mentions_keeps_reply_mentions(
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
    loaded = _load(repository, comment.id)

    _save(repository, loaded, _edit(loaded, content="updated", mentioned_user_ids=()))

    assert _mention_user_ids(sqlite_session, comment.id) == []
    assert _mention_user_ids(sqlite_session, comment.id, reply_id=reply.id) == [USER_3_ID]


def test_save_comment_persists_a_resolution(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    loaded = _load(repository, comment.id)

    _save(repository, loaded, loaded.resolve(actor_id=USER_2_ID, now=NOW))

    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(WorkflowComment, comment.id)
    assert (persisted.resolved, persisted.resolved_at, persisted.resolved_by) == (True, NOW, USER_2_ID)
    assert persisted.updated_at == NOW


def test_save_comment_writes_only_what_the_change_touched(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    loaded_for_edit = _load(repository, comment.id)
    loaded_for_resolve = _load(repository, comment.id)

    # Two requests load the same thread; the later save must not undo the earlier one.
    _save(repository, loaded_for_resolve, loaded_for_resolve.resolve(actor_id=USER_2_ID, now=NOW))
    _save(repository, loaded_for_edit, _edit(loaded_for_edit, content="updated", mentioned_user_ids=None))

    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(WorkflowComment, comment.id)
    assert persisted.content == "updated"
    assert (persisted.resolved, persisted.resolved_by) == (True, USER_2_ID)


def test_save_comment_keeps_replies_added_concurrently(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    first = _load(repository, comment.id)
    second = _load(repository, comment.id)

    _save(
        repository,
        first,
        first.add_reply(reply_id="reply-first", actor_id=USER_2_ID, content="one", mentioned_user_ids=(), now=NOW),
    )
    _save(
        repository,
        second,
        second.add_reply(reply_id="reply-second", actor_id=USER_3_ID, content="two", mentioned_user_ids=(), now=NOW),
    )

    assert sorted(reply.id for reply in _load(repository, comment.id).replies) == ["reply-first", "reply-second"]


def test_save_comment_inserts_a_reply_with_member_mentions(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(
        sqlite_session,
        _app(),
        _account(OWNER_ID),
        _account(USER_2_ID, email="member@example.com"),
        _membership(USER_2_ID),
        comment,
    )
    loaded = _load(repository, comment.id)
    changed = loaded.add_reply(
        reply_id="55555555-5555-5555-5555-555555555555",
        actor_id=OWNER_ID,
        content="hello",
        mentioned_user_ids=(USER_2_ID, OUTSIDER_ID),
        now=NOW,
    )

    mentions = _save(repository, loaded, changed)

    reply = sqlite_session.get_one(WorkflowCommentReply, "55555555-5555-5555-5555-555555555555")
    assert (reply.comment_id, reply.content, reply.created_by) == (comment.id, "hello", OWNER_ID)
    assert (reply.created_at, reply.updated_at) == (NOW, NOW)
    assert _mention_user_ids(sqlite_session, comment.id, reply_id=reply.id) == [USER_2_ID]
    assert [recipient.email for recipient in mentions.recipients] == ["member@example.com"]


def test_save_comment_updates_a_reply_and_replaces_its_mentions(
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
    loaded = _load(repository, comment.id)
    changed = loaded.edit_reply(
        reply_id=reply.id, actor_id=OWNER_ID, content="new", mentioned_user_ids=(USER_2_ID, USER_3_ID), now=NOW
    )

    mentions = _save(repository, loaded, changed)

    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(WorkflowCommentReply, reply.id)
    assert (persisted.content, persisted.updated_at) == ("new", NOW)
    assert _mention_user_ids(sqlite_session, comment.id, reply_id=reply.id) == [USER_2_ID, USER_3_ID]
    assert [recipient.email for recipient in mentions.recipients] == ["new@example.com"]
    # The comment row itself is not part of a reply edit.
    assert sqlite_session.get_one(WorkflowComment, comment.id).updated_at == comment.updated_at


def test_save_comment_removes_a_reply_with_its_mentions(
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
    reply_id = reply.id
    loaded = _load(repository, comment.id)

    _save(repository, loaded, loaded.remove_reply(reply_id=reply_id, actor_id=OWNER_ID))

    sqlite_session.expire_all()
    assert sqlite_session.get(WorkflowCommentReply, reply_id) is None
    assert _mention_user_ids(sqlite_session, comment.id, reply_id=reply_id) == []
    assert _mention_user_ids(sqlite_session, comment.id) == [USER_2_ID]


def test_save_comment_rejects_a_comment_deleted_after_the_load(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    loaded = _load(repository, comment.id)
    repository.delete_comment(comment=loaded)

    with pytest.raises(WorkflowCommentNotFoundError):
        _save(
            repository,
            loaded,
            loaded.add_reply(reply_id="reply-1", actor_id=OWNER_ID, content="late", mentioned_user_ids=(), now=NOW),
        )

    assert sqlite_session.scalar(select(func.count(WorkflowCommentReply.id))) == 0


def test_save_comment_rejects_a_reply_deleted_after_the_load(
    sqlite_session: Session, repository: WorkflowCommentRepository
) -> None:
    comment = _comment()
    _persist(sqlite_session, _membership(USER_2_ID), comment)
    reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=OWNER_ID)
    _persist(sqlite_session, reply)
    loaded_for_edit = _load(repository, comment.id)
    loaded_for_delete = _load(repository, comment.id)
    _save(repository, loaded_for_delete, loaded_for_delete.remove_reply(reply_id=reply.id, actor_id=OWNER_ID))

    with pytest.raises(WorkflowCommentReplyNotFoundError):
        _save(
            repository,
            loaded_for_edit,
            loaded_for_edit.edit_reply(
                reply_id=reply.id, actor_id=OWNER_ID, content="new", mentioned_user_ids=(USER_2_ID,), now=NOW
            ),
        )

    assert sqlite_session.scalar(select(func.count(WorkflowCommentMention.id))) == 0


def test_writes_are_scoped_to_the_thread_owner(sqlite_session: Session, repository: WorkflowCommentRepository) -> None:
    comment = _comment()
    _persist(sqlite_session, comment)
    loaded = _load(repository, comment.id)
    elsewhere = replace(loaded, workspace_id=OTHER_TENANT_ID)

    with pytest.raises(WorkflowCommentNotFoundError):
        _save(repository, elsewhere, elsewhere.resolve(actor_id=OWNER_ID, now=NOW))
    with pytest.raises(WorkflowCommentNotFoundError):
        repository.delete_comment(comment=replace(loaded, app_id=OTHER_APP_ID))

    sqlite_session.expire_all()
    assert sqlite_session.get_one(WorkflowComment, comment.id).resolved is False


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

    repository.delete_comment(comment=_load(repository, comment_id))

    sqlite_session.expire_all()
    assert sqlite_session.get(WorkflowComment, comment_id) is None
    assert sqlite_session.scalar(select(func.count(WorkflowCommentReply.id))) == 0
    assert sqlite_session.scalar(select(func.count(WorkflowCommentMention.id))) == 0


def test_service_rejects_edits_by_another_account_without_writing(
    sqlite_session: Session, comment_service: WorkflowCommentService
) -> None:
    comment = _comment(created_by=OWNER_ID)
    _persist(sqlite_session, _app(), comment)

    with pytest.raises(WorkflowCommentPermissionError, match="Only the comment creator can update it"):
        comment_service.update_comment(
            _context(OUTSIDER_ID),
            APP_ID,
            comment.id,
            WorkflowCommentEdit(content="x", position_x=None, position_y=None, mentioned_user_ids=None),
        )

    sqlite_session.expire_all()
    assert sqlite_session.get_one(WorkflowComment, comment.id).content == "hello"


def test_update_comment_enqueues_mention_email_only_for_new_mentions(
    sqlite_session: Session, comment_service: WorkflowCommentService, enqueued: EnqueuedEmails
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

    assert enqueued.calls == [
        {
            "language": "zh-Hans",
            "to": "new@example.com",
            "mentioned_name": "New User",
            "commenter_name": "Owner",
            "app_name": "Canvas",
            "comment_content": "updated",
            "app_url": f"https://console.example.com/app/{APP_ID}/workflow",
        }
    ]
    assert sorted(_mention_user_ids(sqlite_session, comment.id)) == [USER_2_ID, USER_3_ID]


def test_update_comment_without_mention_list_enqueues_nothing(
    sqlite_session: Session, comment_service: WorkflowCommentService, enqueued: EnqueuedEmails
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

    assert enqueued.calls == []


def test_create_comment_and_reply_enqueue_mention_emails_after_commit(
    sqlite_session: Session,
    comment_service: WorkflowCommentService,
    enqueued: EnqueuedEmails,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _persist(
        sqlite_session,
        _app(),
        _account(OWNER_ID, name="Owner"),
        _account(USER_2_ID, name="Member", email="member@example.com"),
        _membership(OWNER_ID),
        _membership(USER_2_ID),
    )

    def enqueue_after_commit(**kwargs: str) -> None:
        # The email is enqueued only once the mention row is visible to other sessions.
        with Session(sqlite_session.get_bind()) as other_session:
            assert (other_session.scalar(select(func.count(WorkflowCommentMention.id))) or 0) > 0
        enqueued(**kwargs)

    monkeypatch.setattr(
        workflow_comment_mention_gateway.send_workflow_comment_mention_email_task, "delay", enqueue_after_commit
    )

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
    assert [call["to"] for call in enqueued.calls] == ["member@example.com", "member@example.com"]
    assert [call["comment_content"] for call in enqueued.calls] == ["hello", "reply"]
    assert created.created_at == NOW


def test_update_reply_enqueues_mention_email_only_for_new_mentions(
    sqlite_session: Session, comment_service: WorkflowCommentService, enqueued: EnqueuedEmails
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

    assert [call["to"] for call in enqueued.calls] == ["new@example.com"]
