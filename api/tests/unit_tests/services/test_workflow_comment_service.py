"""Persistence-focused tests for :mod:`services.workflow_comment_service`.

The service opens its own sessions for most operations, so these tests bind it to the
same disposable SQLite engine used for fixture setup and assert committed database
state. External task dispatch and the clock remain mocked at their I/O boundaries.
"""

from collections.abc import Iterator
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from models import App, TenantAccountJoin, WorkflowComment, WorkflowCommentMention, WorkflowCommentReply
from models.account import Account, TenantAccountRole
from models.model import AppMode
from services import workflow_comment_service as service_module
from services.workflow_comment_service import WorkflowCommentService

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
    mock = Mock()
    monkeypatch.setattr(service_module.send_workflow_comment_mention_email_task, "delay", mock)
    return mock


@pytest.fixture
def sqlite_session(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    delay_mock: Mock,
) -> Iterator[Session]:
    """Create all tables queried by the service and bind service-owned sessions to SQLite."""
    models = (
        Account,
        TenantAccountJoin,
        App,
        WorkflowComment,
        WorkflowCommentReply,
        WorkflowCommentMention,
    )
    tables = [model.metadata.tables[model.__tablename__] for model in models]
    WorkflowComment.metadata.create_all(sqlite_engine, tables=tables)
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=sqlite_engine))

    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


def _account(
    account_id: str,
    *,
    name: str = "Test User",
    email: str = "user@example.com",
    interface_language: str | None = "en-US",
) -> Account:
    account = Account(name=name, email=email, interface_language=interface_language)
    account.id = account_id
    return account


def _app(*, app_id: str = APP_ID, tenant_id: str = TENANT_ID, name: str = "My App") -> App:
    app = App(
        tenant_id=tenant_id,
        name=name,
        mode=AppMode.WORKFLOW,
        enable_site=False,
        enable_api=False,
        created_by=OWNER_ID,
    )
    app.id = app_id
    return app


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
    return TenantAccountJoin(
        tenant_id=tenant_id,
        account_id=account_id,
        role=TenantAccountRole.NORMAL,
    )


def _persist(session: Session, *objects: object) -> None:
    session.add_all(objects)
    session.commit()


class TestWorkflowCommentService:
    def test_validate_content_rejects_empty(self) -> None:
        with pytest.raises(ValueError):
            WorkflowCommentService._validate_content("   ")

    def test_validate_content_rejects_too_long(self) -> None:
        with pytest.raises(ValueError):
            WorkflowCommentService._validate_content("a" * 1001)

    def test_filter_valid_mentioned_user_ids_filters_by_tenant_and_preserves_order(
        self, sqlite_session: Session
    ) -> None:
        _persist(
            sqlite_session,
            _membership(OWNER_ID),
            _membership(USER_2_ID),
            _membership(USER_3_ID, tenant_id=OTHER_TENANT_ID),
        )

        result = WorkflowCommentService._filter_valid_mentioned_user_ids(
            [
                OWNER_ID,
                "",
                123,  # type: ignore[list-item]
                OWNER_ID,
                USER_3_ID,
                USER_2_ID,
            ],
            session=sqlite_session,
            tenant_id=TENANT_ID,
        )

        assert result == [OWNER_ID, USER_2_ID]

    def test_format_comment_excerpt_handles_short_and_long_limits(self) -> None:
        assert WorkflowCommentService._format_comment_excerpt("  hello  ", max_length=10) == "hello"
        assert WorkflowCommentService._format_comment_excerpt("abcdefghijk", max_length=3) == "abc"
        assert WorkflowCommentService._format_comment_excerpt("  abcdefghijk  ", max_length=8) == "abcde..."

    def test_build_mention_email_payloads_returns_empty_for_no_candidates(self, sqlite_session: Session) -> None:
        assert (
            WorkflowCommentService._build_mention_email_payloads(
                session=sqlite_session,
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                mentioner_id=OWNER_ID,
                mentioned_user_ids=[],
                content="hello",
            )
            == []
        )
        assert (
            WorkflowCommentService._build_mention_email_payloads(
                session=sqlite_session,
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                mentioner_id=OWNER_ID,
                mentioned_user_ids=[OWNER_ID],
                content="hello",
            )
            == []
        )

    def test_dispatch_mention_emails_enqueues_each_payload(self) -> None:
        delay_mock = Mock()
        with patch.object(service_module.send_workflow_comment_mention_email_task, "delay", delay_mock):
            WorkflowCommentService._dispatch_mention_emails(
                [
                    {"to": "a@example.com"},
                    {"to": "b@example.com"},
                ]
            )

        assert delay_mock.call_count == 2

    def test_build_mention_email_payloads_skips_accounts_without_email(self, sqlite_session: Session) -> None:
        _persist(
            sqlite_session,
            _app(),
            _account(OWNER_ID, name="Commenter", email="commenter@example.com"),
            _account(USER_2_ID, name="No Email", email=""),
            _account(USER_3_ID, name="", email="user@example.com", interface_language=None),
            _membership(USER_2_ID),
            _membership(USER_3_ID),
        )

        payloads = WorkflowCommentService._build_mention_email_payloads(
            session=sqlite_session,
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            mentioner_id=OWNER_ID,
            mentioned_user_ids=[USER_2_ID, USER_3_ID],
            content="hello",
        )
        expected_app_url = f"{service_module.dify_config.CONSOLE_WEB_URL.rstrip('/')}/app/{APP_ID}/workflow"

        assert payloads == [
            {
                "language": "en-US",
                "to": "user@example.com",
                "mentioned_name": "user@example.com",
                "commenter_name": "Commenter",
                "app_name": "My App",
                "comment_content": "hello",
                "app_url": expected_app_url,
            }
        ]

    def test_create_comment_creates_mentions(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _membership(USER_2_ID))

        result = WorkflowCommentService.create_comment(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            created_by=OWNER_ID,
            content="hello",
            position_x=1.0,
            position_y=2.0,
            mentioned_user_ids=[USER_2_ID, OUTSIDER_ID],
        )

        comment = sqlite_session.get(WorkflowComment, result["id"])
        assert comment is not None
        assert comment.content == "hello"
        assert comment.created_at == result["created_at"]
        mentions = sqlite_session.scalars(
            select(WorkflowCommentMention).where(WorkflowCommentMention.comment_id == comment.id)
        ).all()
        assert [mention.mentioned_user_id for mention in mentions] == [USER_2_ID]

    def test_update_comment_raises_not_found(self, sqlite_session: Session) -> None:
        with pytest.raises(NotFound):
            WorkflowCommentService.update_comment(
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                comment_id="missing-comment",
                user_id=OWNER_ID,
                content="hello",
            )

    def test_update_comment_raises_forbidden(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)

        with pytest.raises(Forbidden):
            WorkflowCommentService.update_comment(
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                comment_id=comment.id,
                user_id=OUTSIDER_ID,
                content="hello",
            )

    def test_update_comment_replaces_mentions(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)
        _persist(
            sqlite_session,
            WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_3_ID),
            WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_4_ID),
            _membership(USER_2_ID),
        )

        result = WorkflowCommentService.update_comment(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            user_id=OWNER_ID,
            content="updated",
            mentioned_user_ids=[USER_2_ID, OUTSIDER_ID],
        )

        sqlite_session.expire_all()
        persisted_comment = sqlite_session.get(WorkflowComment, comment.id)
        assert persisted_comment is not None
        assert persisted_comment.content == "updated"
        assert result == {"id": comment.id, "updated_at": persisted_comment.updated_at}
        mentions = sqlite_session.scalars(
            select(WorkflowCommentMention).where(WorkflowCommentMention.comment_id == comment.id)
        ).all()
        assert [mention.mentioned_user_id for mention in mentions] == [USER_2_ID]

    def test_update_comment_preserves_mentions_when_mentioned_user_ids_omitted(
        self, sqlite_session: Session, delay_mock: Mock
    ) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)
        mention = WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID)
        _persist(sqlite_session, mention)

        WorkflowCommentService.update_comment(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            user_id=OWNER_ID,
            content="updated",
        )

        sqlite_session.expire_all()
        persisted_comment = sqlite_session.get(WorkflowComment, comment.id)
        assert persisted_comment is not None
        assert persisted_comment.content == "updated"
        assert sqlite_session.get(WorkflowCommentMention, mention.id) is not None
        delay_mock.assert_not_called()

    def test_update_comment_clears_mentions_when_empty_list_provided(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)
        _persist(
            sqlite_session,
            WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID),
            WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_3_ID),
        )

        WorkflowCommentService.update_comment(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            user_id=OWNER_ID,
            content="updated",
            mentioned_user_ids=[],
        )

        mention_count = sqlite_session.scalar(
            select(func.count())
            .select_from(WorkflowCommentMention)
            .where(WorkflowCommentMention.comment_id == comment.id)
        )
        assert mention_count == 0

    def test_update_comment_notifies_only_new_mentions(self, sqlite_session: Session, delay_mock: Mock) -> None:
        comment = _comment()
        _persist(
            sqlite_session,
            _app(),
            _account(OWNER_ID, name="Owner", email="owner@example.com"),
            _account(USER_2_ID, name="Existing", email="existing@example.com"),
            _account(USER_3_ID, name="New User", email="new@example.com"),
            _membership(USER_2_ID),
            _membership(USER_3_ID),
            comment,
        )
        _persist(sqlite_session, WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_2_ID))

        WorkflowCommentService.update_comment(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            user_id=OWNER_ID,
            content="updated",
            mentioned_user_ids=[USER_2_ID, USER_3_ID],
        )

        delay_mock.assert_called_once()
        assert delay_mock.call_args.kwargs["to"] == "new@example.com"
        mentions = sqlite_session.scalars(
            select(WorkflowCommentMention).where(WorkflowCommentMention.comment_id == comment.id)
        ).all()
        assert {mention.mentioned_user_id for mention in mentions} == {USER_2_ID, USER_3_ID}

    def test_get_comments_preloads_related_accounts(self, sqlite_session: Session) -> None:
        comment = _comment(resolved=True, resolved_by=USER_2_ID)
        _persist(
            sqlite_session,
            _account(OWNER_ID, name="Owner"),
            _account(USER_2_ID, name="Resolver"),
            _account(USER_3_ID, name="Replier"),
            _account(USER_4_ID, name="Mentioned"),
            comment,
        )
        reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=USER_3_ID)
        mention = WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_4_ID)
        _persist(sqlite_session, reply, mention)

        result = WorkflowCommentService.get_comments(TENANT_ID, APP_ID)

        assert len(result) == 1
        loaded_comment = result[0]
        assert loaded_comment.id == comment.id
        assert loaded_comment.created_by_account.id == OWNER_ID
        assert loaded_comment.resolved_by_account.id == USER_2_ID
        assert loaded_comment.replies[0].created_by_account.id == USER_3_ID
        assert loaded_comment.mentions[0].mentioned_user_account.id == USER_4_ID

    def test_preload_accounts_returns_early_for_empty_comments(self, sqlite_session: Session) -> None:
        statements: list[str] = []
        bind = sqlite_session.get_bind()

        def record_sql(*args: object) -> None:
            statements.append(str(args[2]))

        event.listen(bind, "before_cursor_execute", record_sql)
        try:
            WorkflowCommentService._preload_accounts(sqlite_session, [])
        finally:
            event.remove(bind, "before_cursor_execute", record_sql)

        assert statements == []

    def test_get_comment_raises_not_found_with_provided_session(self, sqlite_session: Session) -> None:
        with pytest.raises(NotFound):
            WorkflowCommentService.get_comment(TENANT_ID, APP_ID, "missing-comment", session=sqlite_session)

    def test_get_comment_uses_context_manager_when_session_not_provided(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, _account(OWNER_ID, name="Owner"), comment)

        result = WorkflowCommentService.get_comment(TENANT_ID, APP_ID, comment.id)

        assert result.id == comment.id
        assert result.created_by_account.id == OWNER_ID
        assert result.resolved_by_account is None

    def test_delete_comment_raises_forbidden(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)

        with pytest.raises(Forbidden):
            WorkflowCommentService.delete_comment(TENANT_ID, APP_ID, comment.id, OUTSIDER_ID)

        assert sqlite_session.get(WorkflowComment, comment.id) is not None

    def test_delete_comment_removes_related_entities(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)
        comment_id = comment.id
        reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=USER_2_ID)
        _persist(sqlite_session, reply)
        _persist(
            sqlite_session,
            WorkflowCommentMention(comment_id=comment.id, mentioned_user_id=USER_3_ID),
            WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=USER_4_ID),
        )

        WorkflowCommentService.delete_comment(TENANT_ID, APP_ID, comment_id, OWNER_ID)

        sqlite_session.expire_all()
        assert sqlite_session.get(WorkflowComment, comment_id) is None
        assert (
            sqlite_session.scalar(
                select(func.count())
                .select_from(WorkflowCommentReply)
                .where(WorkflowCommentReply.comment_id == comment_id)
            )
            == 0
        )
        assert (
            sqlite_session.scalar(
                select(func.count())
                .select_from(WorkflowCommentMention)
                .where(WorkflowCommentMention.comment_id == comment_id)
            )
            == 0
        )

    def test_resolve_comment_sets_fields(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)
        now = datetime(2026, 7, 10, 12, 0, 0)

        with patch.object(service_module, "naive_utc_now", return_value=now):
            result = WorkflowCommentService.resolve_comment(TENANT_ID, APP_ID, comment.id, USER_2_ID)

        assert result.resolved is True
        assert result.resolved_at == now
        assert result.resolved_by == USER_2_ID
        sqlite_session.expire_all()
        persisted_comment = sqlite_session.get(WorkflowComment, comment.id)
        assert persisted_comment is not None
        assert persisted_comment.resolved is True
        assert persisted_comment.resolved_at == now
        assert persisted_comment.resolved_by == USER_2_ID

    def test_resolve_comment_noop_when_already_resolved(self, sqlite_session: Session) -> None:
        resolved_at = datetime(2026, 7, 9, 12, 0, 0)
        comment = _comment(resolved=True, resolved_at=resolved_at, resolved_by=USER_2_ID)
        _persist(sqlite_session, comment)

        result = WorkflowCommentService.resolve_comment(TENANT_ID, APP_ID, comment.id, USER_3_ID)

        assert result.resolved_at == resolved_at
        assert result.resolved_by == USER_2_ID

    def test_create_reply_requires_comment(self, sqlite_session: Session) -> None:
        with pytest.raises(NotFound):
            WorkflowCommentService.create_reply("missing-comment", "hello", OWNER_ID)

    def test_create_reply_creates_mentions(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment, _membership(USER_2_ID))

        result = WorkflowCommentService.create_reply(
            comment_id=comment.id,
            content="hello",
            created_by=OWNER_ID,
            mentioned_user_ids=[USER_2_ID, OUTSIDER_ID],
        )

        reply = sqlite_session.get(WorkflowCommentReply, result["id"])
        assert reply is not None
        assert reply.content == "hello"
        assert reply.created_at == result["created_at"]
        mentions = sqlite_session.scalars(
            select(WorkflowCommentMention).where(WorkflowCommentMention.reply_id == reply.id)
        ).all()
        assert [mention.mentioned_user_id for mention in mentions] == [USER_2_ID]

    def test_update_reply_raises_not_found(self, sqlite_session: Session) -> None:
        with pytest.raises(NotFound):
            WorkflowCommentService.update_reply(
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                comment_id="missing-comment",
                reply_id="missing-reply",
                user_id=OWNER_ID,
                content="hello",
            )

    def test_update_reply_raises_forbidden(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)
        reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=OWNER_ID)
        _persist(sqlite_session, reply)

        with pytest.raises(Forbidden):
            WorkflowCommentService.update_reply(
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                comment_id=comment.id,
                reply_id=reply.id,
                user_id=OUTSIDER_ID,
                content="hello",
            )

    def test_update_reply_replaces_mentions(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment, _membership(USER_2_ID))
        reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=OWNER_ID)
        _persist(sqlite_session, reply)
        _persist(
            sqlite_session,
            WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=USER_3_ID),
        )

        result = WorkflowCommentService.update_reply(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            reply_id=reply.id,
            user_id=OWNER_ID,
            content="new",
            mentioned_user_ids=[USER_2_ID, OUTSIDER_ID],
        )

        sqlite_session.expire_all()
        persisted_reply = sqlite_session.get(WorkflowCommentReply, reply.id)
        assert persisted_reply is not None
        assert persisted_reply.content == "new"
        assert result == {"id": reply.id, "updated_at": persisted_reply.updated_at}
        mentions = sqlite_session.scalars(
            select(WorkflowCommentMention).where(WorkflowCommentMention.reply_id == reply.id)
        ).all()
        assert [mention.mentioned_user_id for mention in mentions] == [USER_2_ID]

    def test_update_comment_updates_position_coordinates_when_provided(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)

        WorkflowCommentService.update_comment(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            user_id=OWNER_ID,
            content="updated",
            position_x=10.5,
            position_y=20.5,
            mentioned_user_ids=[],
        )

        sqlite_session.expire_all()
        persisted_comment = sqlite_session.get(WorkflowComment, comment.id)
        assert persisted_comment is not None
        assert persisted_comment.position_x == 10.5
        assert persisted_comment.position_y == 20.5

    def test_delete_reply_raises_forbidden(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)
        reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=OWNER_ID)
        _persist(sqlite_session, reply)

        with pytest.raises(Forbidden):
            WorkflowCommentService.delete_reply(
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                comment_id=comment.id,
                reply_id=reply.id,
                user_id=OUTSIDER_ID,
            )

    def test_delete_reply_raises_not_found(self, sqlite_session: Session) -> None:
        with pytest.raises(NotFound):
            WorkflowCommentService.delete_reply(
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                comment_id="missing-comment",
                reply_id="missing-reply",
                user_id=OWNER_ID,
            )

    def test_delete_reply_removes_mentions(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)
        reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=OWNER_ID)
        _persist(sqlite_session, reply)
        reply_id = reply.id
        _persist(
            sqlite_session,
            WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=USER_2_ID),
            WorkflowCommentMention(comment_id=comment.id, reply_id=reply.id, mentioned_user_id=USER_3_ID),
        )

        WorkflowCommentService.delete_reply(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            comment_id=comment.id,
            reply_id=reply_id,
            user_id=OWNER_ID,
        )

        sqlite_session.expire_all()
        assert sqlite_session.get(WorkflowCommentReply, reply_id) is None
        assert (
            sqlite_session.scalar(
                select(func.count())
                .select_from(WorkflowCommentMention)
                .where(WorkflowCommentMention.reply_id == reply_id)
            )
            == 0
        )

    def test_validate_comment_access_delegates_to_get_comment(self, sqlite_session: Session) -> None:
        comment = _comment()
        _persist(sqlite_session, comment)

        result = WorkflowCommentService.validate_comment_access(comment.id, TENANT_ID, APP_ID)

        assert result.id == comment.id

    def test_reply_lookup_is_scoped_to_tenant_app_and_comment(self, sqlite_session: Session) -> None:
        comment = _comment()
        other_comment = _comment(app_id=OTHER_APP_ID)
        _persist(sqlite_session, comment, other_comment)
        reply = WorkflowCommentReply(comment_id=comment.id, content="reply", created_by=OWNER_ID)
        _persist(sqlite_session, reply)

        with pytest.raises(NotFound):
            WorkflowCommentService.update_reply(
                tenant_id=TENANT_ID,
                app_id=OTHER_APP_ID,
                comment_id=other_comment.id,
                reply_id=reply.id,
                user_id=OWNER_ID,
                content="cross-thread update",
            )

        sqlite_session.refresh(reply)
        assert reply.content == "reply"
