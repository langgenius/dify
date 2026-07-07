from unittest.mock import MagicMock, Mock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

from services import workflow_comment_service as service_module
from services.workflow_comment_service import WorkflowCommentService


@pytest.fixture
def mock_session(monkeypatch: pytest.MonkeyPatch) -> Mock:
    session = Mock()
    context_manager = MagicMock()
    context_manager.__enter__.return_value = session
    context_manager.__exit__.return_value = False
    mock_db = MagicMock()
    mock_db.engine = Mock()
    empty_scalars = Mock()
    empty_scalars.all.return_value = []
    session.scalars.return_value = empty_scalars
    monkeypatch.setattr(service_module, "Session", Mock(return_value=context_manager))
    monkeypatch.setattr(service_module, "db", mock_db)
    monkeypatch.setattr(service_module.send_workflow_comment_mention_email_task, "delay", Mock())
    return session


def _mock_scalars(result_list: list[object]) -> Mock:
    scalars = Mock()
    scalars.all.return_value = result_list
    return scalars


class TestWorkflowCommentService:
    def test_validate_content_rejects_empty(self) -> None:
        with pytest.raises(ValueError):
            WorkflowCommentService._validate_content("   ")

    def test_validate_content_rejects_too_long(self) -> None:
        with pytest.raises(ValueError):
            WorkflowCommentService._validate_content("a" * 1001)

    def test_filter_valid_mentioned_user_ids_filters_by_tenant_and_preserves_order(self, mock_session: Mock) -> None:
        tenant_member_1 = "123e4567-e89b-12d3-a456-426614174000"
        tenant_member_2 = "123e4567-e89b-12d3-a456-426614174002"
        non_tenant_member = "123e4567-e89b-12d3-a456-426614174001"
        mock_session.scalars.return_value = _mock_scalars([tenant_member_1, tenant_member_2])

        result = WorkflowCommentService._filter_valid_mentioned_user_ids(
            [
                tenant_member_1,
                "",
                123,  # type: ignore[list-item]
                tenant_member_1,
                non_tenant_member,
                tenant_member_2,
            ],
            session=mock_session,
            tenant_id="tenant-1",
        )

        assert result == [
            tenant_member_1,
            tenant_member_2,
        ]

    def test_format_comment_excerpt_handles_short_and_long_limits(self) -> None:
        assert WorkflowCommentService._format_comment_excerpt("  hello  ", max_length=10) == "hello"
        assert WorkflowCommentService._format_comment_excerpt("abcdefghijk", max_length=3) == "abc"
        assert WorkflowCommentService._format_comment_excerpt("  abcdefghijk  ", max_length=8) == "abcde..."

    def test_build_mention_email_payloads_returns_empty_for_no_candidates(self, mock_session: Mock) -> None:
        assert (
            WorkflowCommentService._build_mention_email_payloads(
                session=mock_session,
                tenant_id="tenant-1",
                app_id="app-1",
                mentioner_id="user-1",
                mentioned_user_ids=[],
                content="hello",
            )
            == []
        )
        assert (
            WorkflowCommentService._build_mention_email_payloads(
                session=mock_session,
                tenant_id="tenant-1",
                app_id="app-1",
                mentioner_id="user-1",
                mentioned_user_ids=["user-1"],
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

    def test_build_mention_email_payloads_skips_accounts_without_email(self, mock_session: Mock) -> None:
        account_without_email = Mock()
        account_without_email.email = None
        account_without_email.name = "No Email"
        account_without_email.interface_language = "en-US"

        account_with_email = Mock()
        account_with_email.email = "user@example.com"
        account_with_email.name = ""
        account_with_email.interface_language = None

        mock_session.scalar.side_effect = ["My App", "Commenter"]
        mock_session.scalars.return_value = _mock_scalars([account_without_email, account_with_email])

        payloads = WorkflowCommentService._build_mention_email_payloads(
            session=mock_session,
            tenant_id="tenant-1",
            app_id="app-1",
            mentioner_id="user-1",
            mentioned_user_ids=["user-2"],
            content="hello",
        )
        expected_app_url = f"{service_module.dify_config.CONSOLE_WEB_URL.rstrip('/')}/app/app-1/workflow"

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

    def test_create_comment_creates_mentions(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.id = "comment-1"
        comment.created_at = "ts"

        with (
            patch.object(service_module, "WorkflowComment", return_value=comment),
            patch.object(service_module, "WorkflowCommentMention", return_value=Mock()),
            patch.object(WorkflowCommentService, "_filter_valid_mentioned_user_ids", return_value=["user-2"]),
        ):
            result = WorkflowCommentService.create_comment(
                tenant_id="tenant-1",
                app_id="app-1",
                created_by="user-1",
                content="hello",
                position_x=1.0,
                position_y=2.0,
                mentioned_user_ids=["user-2", "bad-id"],
            )

        assert result == {"id": "comment-1", "created_at": "ts"}
        assert mock_session.add.call_args_list[0].args[0] is comment
        assert mock_session.add.call_count == 2
        mock_session.commit.assert_called_once()

    def test_update_comment_raises_not_found(self, mock_session: Mock) -> None:
        mock_session.scalar.return_value = None

        with pytest.raises(NotFound):
            WorkflowCommentService.update_comment(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                user_id="user-1",
                content="hello",
            )

    def test_update_comment_raises_forbidden(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.created_by = "owner"
        mock_session.scalar.return_value = comment

        with pytest.raises(Forbidden):
            WorkflowCommentService.update_comment(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                user_id="intruder",
                content="hello",
            )

    def test_update_comment_replaces_mentions(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.id = "comment-1"
        comment.created_by = "owner"
        mock_session.scalar.return_value = comment

        existing_mentions = [Mock(), Mock()]
        mock_session.scalars.return_value = _mock_scalars(existing_mentions)

        with patch.object(WorkflowCommentService, "_filter_valid_mentioned_user_ids", return_value=["user-2"]):
            result = WorkflowCommentService.update_comment(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                user_id="owner",
                content="updated",
                mentioned_user_ids=["user-2", "bad-id"],
            )

        assert result == {"id": "comment-1", "updated_at": comment.updated_at}
        assert mock_session.delete.call_count == 2
        assert mock_session.add.call_count == 1
        mock_session.commit.assert_called_once()

    def test_update_comment_preserves_mentions_when_mentioned_user_ids_omitted(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.id = "comment-1"
        comment.created_by = "owner"
        mock_session.scalar.return_value = comment

        with (
            patch.object(WorkflowCommentService, "_filter_valid_mentioned_user_ids") as filter_mentions_mock,
            patch.object(WorkflowCommentService, "_build_mention_email_payloads") as build_payloads_mock,
            patch.object(WorkflowCommentService, "_dispatch_mention_emails") as dispatch_mock,
        ):
            result = WorkflowCommentService.update_comment(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                user_id="owner",
                content="updated",
            )

        assert result == {"id": "comment-1", "updated_at": comment.updated_at}
        mock_session.delete.assert_not_called()
        mock_session.add.assert_not_called()
        filter_mentions_mock.assert_not_called()
        build_payloads_mock.assert_not_called()
        dispatch_mock.assert_called_once_with([])
        mock_session.commit.assert_called_once()

    def test_update_comment_clears_mentions_when_empty_list_provided(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.id = "comment-1"
        comment.created_by = "owner"
        mock_session.scalar.return_value = comment

        existing_mentions = [Mock(), Mock()]
        mock_session.scalars.return_value = _mock_scalars(existing_mentions)

        with patch.object(WorkflowCommentService, "_filter_valid_mentioned_user_ids", return_value=[]):
            result = WorkflowCommentService.update_comment(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                user_id="owner",
                content="updated",
                mentioned_user_ids=[],
            )

        assert result == {"id": "comment-1", "updated_at": comment.updated_at}
        assert mock_session.delete.call_count == 2
        mock_session.add.assert_not_called()
        mock_session.commit.assert_called_once()

    def test_update_comment_notifies_only_new_mentions(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.id = "comment-1"
        comment.created_by = "owner"
        mock_session.scalar.return_value = comment

        existing_mention = Mock()
        existing_mention.mentioned_user_id = "user-2"
        mock_session.scalars.return_value = _mock_scalars([existing_mention])

        with (
            patch.object(
                WorkflowCommentService,
                "_filter_valid_mentioned_user_ids",
                return_value=["user-2", "user-3"],
            ),
            patch.object(
                WorkflowCommentService,
                "_build_mention_email_payloads",
                return_value=[],
            ) as build_payloads_mock,
            patch.object(WorkflowCommentService, "_dispatch_mention_emails") as dispatch_mock,
        ):
            WorkflowCommentService.update_comment(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                user_id="owner",
                content="updated",
                mentioned_user_ids=["user-2", "user-3"],
            )

        assert build_payloads_mock.call_args.kwargs["mentioned_user_ids"] == ["user-3"]
        dispatch_mock.assert_called_once_with([])

    def test_get_comments_preloads_related_accounts(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.created_by = "user-1"
        comment.resolved_by = "user-2"
        reply = Mock()
        reply.created_by = "user-3"
        mention = Mock()
        mention.mentioned_user_id = "user-4"
        comment.replies = [reply]
        comment.mentions = [mention]
        comment.cache_created_by_account = Mock()
        comment.cache_resolved_by_account = Mock()
        reply.cache_created_by_account = Mock()
        mention.cache_mentioned_user_account = Mock()

        account_1 = Mock()
        account_1.id = "user-1"
        account_2 = Mock()
        account_2.id = "user-2"
        account_3 = Mock()
        account_3.id = "user-3"
        account_4 = Mock()
        account_4.id = "user-4"

        mock_session.scalars.side_effect = [
            _mock_scalars([comment]),
            _mock_scalars([account_1, account_2, account_3, account_4]),
        ]

        result = WorkflowCommentService.get_comments("tenant-1", "app-1")

        assert result == [comment]
        comment.cache_created_by_account.assert_called_once_with(account_1)
        comment.cache_resolved_by_account.assert_called_once_with(account_2)
        reply.cache_created_by_account.assert_called_once_with(account_3)
        mention.cache_mentioned_user_account.assert_called_once_with(account_4)

    def test_preload_accounts_returns_early_for_empty_comments(self, mock_session: Mock) -> None:
        WorkflowCommentService._preload_accounts(mock_session, [])

        mock_session.scalars.assert_not_called()

    def test_get_comment_raises_not_found_with_provided_session(self) -> None:
        session = Mock()
        session.scalar.return_value = None

        with pytest.raises(NotFound):
            WorkflowCommentService.get_comment("tenant-1", "app-1", "comment-1", session=session)

    def test_get_comment_uses_context_manager_when_session_not_provided(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.created_by = "user-1"
        comment.resolved_by = None
        comment.replies = []
        comment.mentions = []
        comment.cache_created_by_account = Mock()
        comment.cache_resolved_by_account = Mock()
        mock_session.scalar.return_value = comment
        mock_session.scalars.return_value = _mock_scalars([])

        result = WorkflowCommentService.get_comment("tenant-1", "app-1", "comment-1")

        assert result is comment
        comment.cache_created_by_account.assert_called_once()
        comment.cache_resolved_by_account.assert_called_once_with(None)

    def test_delete_comment_raises_forbidden(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.created_by = "owner"

        with patch.object(WorkflowCommentService, "get_comment", return_value=comment):
            with pytest.raises(Forbidden):
                WorkflowCommentService.delete_comment("tenant-1", "app-1", "comment-1", "intruder")

    def test_delete_comment_removes_related_entities(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.created_by = "owner"

        mentions = [Mock(), Mock()]
        replies = [Mock()]
        mock_session.scalars.side_effect = [_mock_scalars(mentions), _mock_scalars(replies)]

        with patch.object(WorkflowCommentService, "get_comment", return_value=comment):
            WorkflowCommentService.delete_comment("tenant-1", "app-1", "comment-1", "owner")

        assert mock_session.delete.call_count == 4
        mock_session.commit.assert_called_once()

    def test_resolve_comment_sets_fields(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.resolved = False
        comment.resolved_at = None
        comment.resolved_by = None

        with (
            patch.object(WorkflowCommentService, "get_comment", return_value=comment),
            patch.object(service_module, "naive_utc_now", return_value="now"),
        ):
            result = WorkflowCommentService.resolve_comment("tenant-1", "app-1", "comment-1", "user-1")

        assert result is comment
        assert comment.resolved is True
        assert comment.resolved_at == "now"
        assert comment.resolved_by == "user-1"
        mock_session.commit.assert_called_once()

    def test_resolve_comment_noop_when_already_resolved(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.resolved = True

        with patch.object(WorkflowCommentService, "get_comment", return_value=comment):
            result = WorkflowCommentService.resolve_comment("tenant-1", "app-1", "comment-1", "user-1")

        assert result is comment
        mock_session.commit.assert_not_called()

    def test_create_reply_requires_comment(self, mock_session: Mock) -> None:
        mock_session.get.return_value = None

        with pytest.raises(NotFound):
            WorkflowCommentService.create_reply("comment-1", "hello", "user-1")

    def test_create_reply_creates_mentions(self, mock_session: Mock) -> None:
        mock_session.get.return_value = Mock()
        reply = Mock()
        reply.id = "reply-1"
        reply.created_at = "ts"

        with (
            patch.object(service_module, "WorkflowCommentReply", return_value=reply),
            patch.object(service_module, "WorkflowCommentMention", return_value=Mock()),
            patch.object(WorkflowCommentService, "_filter_valid_mentioned_user_ids", return_value=["user-2"]),
        ):
            result = WorkflowCommentService.create_reply(
                comment_id="comment-1",
                content="hello",
                created_by="user-1",
                mentioned_user_ids=["user-2", "bad-id"],
            )

        assert result == {"id": "reply-1", "created_at": "ts"}
        assert mock_session.add.call_count == 2
        mock_session.commit.assert_called_once()

    def test_update_reply_raises_not_found(self, mock_session: Mock) -> None:
        mock_session.scalar.return_value = None

        with pytest.raises(NotFound):
            WorkflowCommentService.update_reply(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                reply_id="reply-1",
                user_id="user-1",
                content="hello",
            )

    def test_update_reply_raises_forbidden(self, mock_session: Mock) -> None:
        reply = Mock()
        reply.created_by = "owner"
        mock_session.scalar.return_value = reply

        with pytest.raises(Forbidden):
            WorkflowCommentService.update_reply(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                reply_id="reply-1",
                user_id="intruder",
                content="hello",
            )

    def test_update_reply_replaces_mentions(self, mock_session: Mock) -> None:
        reply = Mock()
        reply.id = "reply-1"
        reply.comment_id = "comment-1"
        reply.created_by = "owner"
        reply.updated_at = "updated"
        mock_session.scalar.return_value = reply
        mock_session.scalars.return_value = _mock_scalars([Mock()])
        comment = Mock()
        comment.tenant_id = "tenant-1"
        comment.app_id = "app-1"
        mock_session.get.return_value = comment

        with patch.object(WorkflowCommentService, "_filter_valid_mentioned_user_ids", return_value=["user-2"]):
            result = WorkflowCommentService.update_reply(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                reply_id="reply-1",
                user_id="owner",
                content="new",
                mentioned_user_ids=["user-2", "bad-id"],
            )

        assert result == {"id": "reply-1", "updated_at": "updated"}
        assert mock_session.delete.call_count == 1
        assert mock_session.add.call_count == 1
        mock_session.commit.assert_called_once()
        mock_session.refresh.assert_called_once_with(reply)

    def test_update_comment_updates_position_coordinates_when_provided(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.id = "comment-1"
        comment.created_by = "owner"
        comment.position_x = 1.0
        comment.position_y = 2.0
        mock_session.scalar.return_value = comment
        mock_session.scalars.return_value = _mock_scalars([])

        WorkflowCommentService.update_comment(
            tenant_id="tenant-1",
            app_id="app-1",
            comment_id="comment-1",
            user_id="owner",
            content="updated",
            position_x=10.5,
            position_y=20.5,
            mentioned_user_ids=[],
        )

        assert comment.position_x == 10.5
        assert comment.position_y == 20.5

    def test_delete_reply_raises_forbidden(self, mock_session: Mock) -> None:
        reply = Mock()
        reply.created_by = "owner"
        mock_session.scalar.return_value = reply

        with pytest.raises(Forbidden):
            WorkflowCommentService.delete_reply(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                reply_id="reply-1",
                user_id="intruder",
            )

    def test_delete_reply_raises_not_found(self, mock_session: Mock) -> None:
        mock_session.scalar.return_value = None

        with pytest.raises(NotFound):
            WorkflowCommentService.delete_reply(
                tenant_id="tenant-1",
                app_id="app-1",
                comment_id="comment-1",
                reply_id="reply-1",
                user_id="owner",
            )

    def test_delete_reply_removes_mentions(self, mock_session: Mock) -> None:
        reply = Mock()
        reply.created_by = "owner"
        mock_session.scalar.return_value = reply
        mock_session.scalars.return_value = _mock_scalars([Mock(), Mock()])

        WorkflowCommentService.delete_reply(
            tenant_id="tenant-1",
            app_id="app-1",
            comment_id="comment-1",
            reply_id="reply-1",
            user_id="owner",
        )

        assert mock_session.delete.call_count == 3
        mock_session.commit.assert_called_once()

    def test_validate_comment_access_delegates_to_get_comment(self) -> None:
        comment = Mock()
        with patch.object(WorkflowCommentService, "get_comment", return_value=comment) as get_comment_mock:
            result = WorkflowCommentService.validate_comment_access("comment-1", "tenant-1", "app-1")

        assert result is comment
        get_comment_mock.assert_called_once_with("tenant-1", "app-1", "comment-1")
