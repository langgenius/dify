from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

from services import workflow_comment_service as service_module
from services.workflow_comment_service import WorkflowCommentService


@pytest.fixture
def mock_session(monkeypatch: pytest.MonkeyPatch) -> Mock:
    session = Mock()
    context_manager = Mock()
    context_manager.__enter__.return_value = session
    context_manager.__exit__.return_value = False
    monkeypatch.setattr(service_module, "Session", Mock(return_value=context_manager))
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

    def test_create_comment_creates_mentions(self, mock_session: Mock) -> None:
        comment = Mock()
        comment.id = "comment-1"
        comment.created_at = "ts"

        with (
            patch.object(service_module, "WorkflowComment", return_value=comment),
            patch.object(service_module, "WorkflowCommentMention", return_value=Mock()),
            patch.object(service_module, "uuid_value", side_effect=[True, False]),
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

        with (
            patch.object(service_module, "WorkflowCommentMention", return_value=Mock()),
            patch.object(service_module, "uuid_value", side_effect=[True, False]),
        ):
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
            patch.object(service_module, "uuid_value", side_effect=[True, False]),
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
        mock_session.get.return_value = None

        with pytest.raises(NotFound):
            WorkflowCommentService.update_reply("reply-1", "user-1", "hello")

    def test_update_reply_raises_forbidden(self, mock_session: Mock) -> None:
        reply = Mock()
        reply.created_by = "owner"
        mock_session.get.return_value = reply

        with pytest.raises(Forbidden):
            WorkflowCommentService.update_reply("reply-1", "intruder", "hello")

    def test_update_reply_replaces_mentions(self, mock_session: Mock) -> None:
        reply = Mock()
        reply.id = "reply-1"
        reply.comment_id = "comment-1"
        reply.created_by = "owner"
        reply.updated_at = "updated"
        mock_session.get.return_value = reply
        mock_session.scalars.return_value = _mock_scalars([Mock()])

        with (
            patch.object(service_module, "WorkflowCommentMention", return_value=Mock()),
            patch.object(service_module, "uuid_value", side_effect=[True, False]),
        ):
            result = WorkflowCommentService.update_reply(
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

    def test_delete_reply_raises_forbidden(self, mock_session: Mock) -> None:
        reply = Mock()
        reply.created_by = "owner"
        mock_session.get.return_value = reply

        with pytest.raises(Forbidden):
            WorkflowCommentService.delete_reply("reply-1", "intruder")

    def test_delete_reply_removes_mentions(self, mock_session: Mock) -> None:
        reply = Mock()
        reply.created_by = "owner"
        mock_session.get.return_value = reply
        mock_session.scalars.return_value = _mock_scalars([Mock(), Mock()])

        WorkflowCommentService.delete_reply("reply-1", "owner")

        assert mock_session.delete.call_count == 3
        mock_session.commit.assert_called_once()
