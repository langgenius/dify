"""Console workflow comment routes keep their admission policy and wire contracts on the application service."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass
from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, HTTPException

from controllers.common.errors import ForbiddenError, InvalidArgumentError, NotFoundError
from controllers.console import console_ns, flask_admission
from controllers.console.app import workflow_comment as workflow_comment_module
from controllers.console.app.error import AppNotFoundError
from controllers.console.app.workflow_comment import (
    WorkflowCommentDetailApi,
    WorkflowCommentListApi,
    WorkflowCommentMentionUsersApi,
    WorkflowCommentReplyApi,
    WorkflowCommentReplyDetailApi,
    WorkflowCommentResolveApi,
)
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.app.workflow_comment_service import (
    InvalidMentionedUserIdError,
    InvalidWorkflowCommentContentError,
    WorkflowCommentAccount,
    WorkflowCommentAppNotFoundError,
    WorkflowCommentCreated,
    WorkflowCommentDetail,
    WorkflowCommentDraft,
    WorkflowCommentEdit,
    WorkflowCommentMentionRecord,
    WorkflowCommentNotFoundError,
    WorkflowCommentPermissionError,
    WorkflowCommentReplyDraft,
    WorkflowCommentReplyNotFoundError,
    WorkflowCommentReplyRecord,
    WorkflowCommentResolved,
    WorkflowCommentSummary,
    WorkflowCommentUpdated,
)
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account

WORKSPACE_ID = "tenant-123"
APP_ID = UUID("11111111-1111-1111-1111-111111111111")
JAN_1_2024_NOON = datetime(2024, 1, 1, 12, 0, 0)
JAN_1_2024_NOON_TS = int(JAN_1_2024_NOON.timestamp())
JAN_1_2024_1201 = datetime(2024, 1, 1, 12, 1, 0)
JAN_1_2024_1201_TS = int(JAN_1_2024_1201.timestamp())
JAN_1_2024_1202 = datetime(2024, 1, 1, 12, 2, 0)
JAN_1_2024_1202_TS = int(JAN_1_2024_1202.timestamp())
JAN_1_2024_1203 = datetime(2024, 1, 1, 12, 3, 0)
JAN_1_2024_1203_TS = int(JAN_1_2024_1203.timestamp())

AUTHOR = WorkflowCommentAccount(
    id="account-123", name="tester", email="tester@example.com", avatar="https://example.com/avatar.png"
)
AUTHOR_JSON = {
    "id": "account-123",
    "name": "tester",
    "email": "tester@example.com",
    "avatar_url": "https://example.com/avatar.png",
}
MENTIONED = WorkflowCommentAccount(id="account-456", name="mentioned", email="mentioned@example.com", avatar=None)
MENTIONED_JSON = {"id": "account-456", "name": "mentioned", "email": "mentioned@example.com", "avatar_url": None}


def admission(method: Callable[..., object]) -> Callable[..., object]:
    """Skip setup/login wrappers and enter at the admission adapter that builds the RequestContext."""
    return unwrap(method, stop=lambda view: "inject_request_context" in view.__code__.co_qualname)


@pytest.fixture
def comments(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    service = MagicMock()
    members = MagicMock()
    monkeypatch.setattr(
        workflow_comment_module,
        "application_services",
        lambda: SimpleNamespace(workflow_comments=service, workspaces=SimpleNamespace(member_queries=members)),
    )
    service.members = members
    return service


def _admit(monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole, *, rbac_enabled: bool = False) -> str:
    account = make_account(account_id="account-123", role=role)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=rbac_enabled)
    monkeypatch.setattr(
        flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, WORKSPACE_ID)
    )
    monkeypatch.setattr(flask_admission, "get_trace_id", lambda: None)
    return account.id


def _payload(payload: dict[str, object] | None) -> AbstractContextManager[object]:
    if payload is None:
        return nullcontext()
    return patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload)


@dataclass(frozen=True)
class WriteCase:
    method: Callable[..., object]
    http_method: str
    kwargs: dict[str, object]
    service: Callable[[MagicMock], MagicMock]
    service_return: object = None
    payload: dict[str, object] | None = None


CREATE_COMMENT = WriteCase(
    WorkflowCommentListApi.post,
    "POST",
    {"app_id": APP_ID},
    lambda comments: comments.create_comment,
    WorkflowCommentCreated(id="comment-1", created_at=JAN_1_2024_NOON),
    {"content": "hello", "position_x": 1.0, "position_y": 2.0, "mentioned_user_ids": []},
)
UPDATE_COMMENT = WriteCase(
    WorkflowCommentDetailApi.put,
    "PUT",
    {"app_id": APP_ID, "comment_id": "comment-1"},
    lambda comments: comments.update_comment,
    WorkflowCommentUpdated(id="comment-1", updated_at=JAN_1_2024_NOON),
    {"content": "hello"},
)
DELETE_COMMENT = WriteCase(
    WorkflowCommentDetailApi.delete,
    "DELETE",
    {"app_id": APP_ID, "comment_id": "comment-1"},
    lambda comments: comments.delete_comment,
)
RESOLVE_COMMENT = WriteCase(
    WorkflowCommentResolveApi.post,
    "POST",
    {"app_id": APP_ID, "comment_id": "comment-1"},
    lambda comments: comments.resolve_comment,
    WorkflowCommentResolved(id="comment-1", resolved=True, resolved_at=JAN_1_2024_NOON, resolved_by="account-123"),
)
CREATE_REPLY = WriteCase(
    WorkflowCommentReplyApi.post,
    "POST",
    {"app_id": APP_ID, "comment_id": "comment-1"},
    lambda comments: comments.create_reply,
    WorkflowCommentCreated(id="reply-1", created_at=JAN_1_2024_NOON),
    {"content": "reply", "mentioned_user_ids": []},
)
UPDATE_REPLY = WriteCase(
    WorkflowCommentReplyDetailApi.put,
    "PUT",
    {"app_id": APP_ID, "comment_id": "comment-1", "reply_id": "reply-1"},
    lambda comments: comments.update_reply,
    WorkflowCommentUpdated(id="reply-1", updated_at=JAN_1_2024_NOON),
    {"content": "reply", "mentioned_user_ids": []},
)
DELETE_REPLY = WriteCase(
    WorkflowCommentReplyDetailApi.delete,
    "DELETE",
    {"app_id": APP_ID, "comment_id": "comment-1", "reply_id": "reply-1"},
    lambda comments: comments.delete_reply,
)
WRITE_CASES = [
    pytest.param(CREATE_COMMENT, id="create-comment"),
    pytest.param(UPDATE_COMMENT, id="update-comment"),
    pytest.param(DELETE_COMMENT, id="delete-comment"),
    pytest.param(RESOLVE_COMMENT, id="resolve-comment"),
    pytest.param(CREATE_REPLY, id="create-reply"),
    pytest.param(UPDATE_REPLY, id="update-reply"),
    pytest.param(DELETE_REPLY, id="delete-reply"),
]


def _call(app: Flask, case: WriteCase) -> object:
    with app.test_request_context(method=case.http_method, json=case.payload), _payload(case.payload):
        return admission(case.method)(None, **case.kwargs)


@pytest.mark.parametrize("case", WRITE_CASES)
@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
def test_write_endpoints_reject_read_only_roles(
    app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock, case: WriteCase, role: TenantAccountRole
) -> None:
    _admit(monkeypatch, role)

    with pytest.raises(Forbidden):
        _call(app, case)

    case.service(comments).assert_not_called()


@pytest.mark.parametrize("case", WRITE_CASES)
@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
def test_write_endpoints_admit_edit_roles(
    app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock, case: WriteCase, role: TenantAccountRole
) -> None:
    _admit(monkeypatch, role)
    case.service(comments).return_value = case.service_return

    _call(app, case)

    case.service(comments).assert_called_once()


@pytest.mark.parametrize("case", WRITE_CASES)
def test_rbac_replaces_the_legacy_role_gate(
    app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock, case: WriteCase
) -> None:
    # Like `edit_permission_required`, the role gate is skipped under RBAC; these routes declare no RBAC checks.
    _admit(monkeypatch, TenantAccountRole.NORMAL, rbac_enabled=True)
    case.service(comments).return_value = case.service_return

    _call(app, case)

    case.service(comments).assert_called_once()


def test_create_comment_passes_request_context_and_typed_draft(
    app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock
) -> None:
    account_id = _admit(monkeypatch, TenantAccountRole.EDITOR)
    comments.create_comment.return_value = CREATE_COMMENT.service_return
    payload: dict[str, object] = {
        "content": "hello",
        "position_x": 1.0,
        "position_y": 2.0,
        "mentioned_user_ids": ["user-1"],
    }

    with app.test_request_context(method="POST", json=payload), _payload(payload):
        result = admission(WorkflowCommentListApi.post)(None, app_id=APP_ID)

    assert result == ({"id": "comment-1", "created_at": JAN_1_2024_NOON_TS}, 201)
    context, app_id, draft = comments.create_comment.call_args.args
    assert isinstance(context, RequestContext)
    assert (context.account_id, context.active_workspace_id) == (account_id, WORKSPACE_ID)
    assert app_id == str(APP_ID)
    assert draft == WorkflowCommentDraft(
        content="hello", position_x=1.0, position_y=2.0, mentioned_user_ids=("user-1",)
    )


def test_update_comment_keeps_omitted_mentions_omitted(
    app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock
) -> None:
    _admit(monkeypatch, TenantAccountRole.EDITOR)
    comments.update_comment.return_value = UPDATE_COMMENT.service_return
    payload: dict[str, object] = {"content": "hello", "position_x": 10.0, "position_y": 20.0}

    with app.test_request_context(method="PUT", json=payload), _payload(payload):
        result = admission(WorkflowCommentDetailApi.put)(None, app_id=APP_ID, comment_id="comment-1")

    assert result == {"id": "comment-1", "updated_at": JAN_1_2024_NOON_TS}
    _, _, comment_id, edit = comments.update_comment.call_args.args
    assert comment_id == "comment-1"
    assert edit == WorkflowCommentEdit(content="hello", position_x=10.0, position_y=20.0, mentioned_user_ids=None)


def test_reply_update_passes_typed_draft(app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock) -> None:
    _admit(monkeypatch, TenantAccountRole.EDITOR)
    comments.update_reply.return_value = UPDATE_REPLY.service_return
    payload: dict[str, object] = {"content": "reply", "mentioned_user_ids": ["user-1"]}

    with app.test_request_context(method="PUT", json=payload), _payload(payload):
        result = admission(WorkflowCommentReplyDetailApi.put)(
            None, app_id=APP_ID, comment_id="comment-1", reply_id="reply-1"
        )

    assert result == {"id": "reply-1", "updated_at": JAN_1_2024_NOON_TS}
    _, _, comment_id, reply_id, draft = comments.update_reply.call_args.args
    assert (comment_id, reply_id) == ("comment-1", "reply-1")
    assert draft == WorkflowCommentReplyDraft(content="reply", mentioned_user_ids=("user-1",))


@pytest.mark.parametrize(
    ("case", "expected"),
    [
        pytest.param(
            RESOLVE_COMMENT,
            {"id": "comment-1", "resolved": True, "resolved_at": JAN_1_2024_NOON_TS, "resolved_by": "account-123"},
            id="resolve",
        ),
        pytest.param(CREATE_REPLY, ({"id": "reply-1", "created_at": JAN_1_2024_NOON_TS}, 201), id="create-reply"),
        pytest.param(DELETE_COMMENT, ("", 204), id="delete-comment"),
        pytest.param(DELETE_REPLY, ("", 204), id="delete-reply"),
    ],
)
def test_mutation_endpoints_serialize_responses(
    app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock, case: WriteCase, expected: object
) -> None:
    _admit(monkeypatch, TenantAccountRole.EDITOR)
    case.service(comments).return_value = case.service_return

    assert _call(app, case) == expected


@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
def test_list_comments_serializes_summaries_for_any_member(
    app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock, role: TenantAccountRole
) -> None:
    _admit(monkeypatch, role)
    comments.list_comments.return_value = (
        WorkflowCommentSummary(
            id="comment-1",
            position_x=1.5,
            position_y=2.5,
            content="hello",
            created_by="account-123",
            created_by_account=AUTHOR,
            created_at=datetime.fromtimestamp(1_700_000_000),
            updated_at=datetime.fromtimestamp(1_700_000_001),
            resolved=False,
            resolved_at=None,
            resolved_by=None,
            resolved_by_account=None,
            reply_count=0,
            mention_count=0,
            participants=(AUTHOR,),
        ),
    )

    with app.test_request_context():
        response = admission(WorkflowCommentListApi.get)(None, app_id=APP_ID)

    assert response == {
        "data": [
            {
                "id": "comment-1",
                "position_x": 1.5,
                "position_y": 2.5,
                "content": "hello",
                "created_by": "account-123",
                "created_by_account": AUTHOR_JSON,
                "created_at": 1_700_000_000,
                "updated_at": 1_700_000_001,
                "resolved": False,
                "resolved_at": None,
                "resolved_by": None,
                "resolved_by_account": None,
                "reply_count": 0,
                "mention_count": 0,
                "participants": [AUTHOR_JSON],
            }
        ]
    }


def test_get_comment_serializes_detail(app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock) -> None:
    _admit(monkeypatch, TenantAccountRole.NORMAL)
    comments.get_comment.return_value = WorkflowCommentDetail(
        id="comment-1",
        position_x=1.5,
        position_y=2.5,
        content="hello",
        created_by="account-123",
        created_by_account=AUTHOR,
        created_at=JAN_1_2024_NOON,
        updated_at=JAN_1_2024_1201,
        resolved=True,
        resolved_at=JAN_1_2024_1202,
        resolved_by="account-123",
        resolved_by_account=AUTHOR,
        replies=(
            WorkflowCommentReplyRecord(
                id="reply-1",
                content="reply",
                created_by="account-456",
                created_by_account=MENTIONED,
                created_at=JAN_1_2024_1203,
            ),
        ),
        mentions=(
            WorkflowCommentMentionRecord(
                mentioned_user_id="account-456", mentioned_user_account=MENTIONED, reply_id="reply-1"
            ),
        ),
    )

    with app.test_request_context():
        response = admission(WorkflowCommentDetailApi.get)(None, app_id=APP_ID, comment_id="comment-1")

    assert response == {
        "id": "comment-1",
        "position_x": 1.5,
        "position_y": 2.5,
        "content": "hello",
        "created_by": "account-123",
        "created_by_account": AUTHOR_JSON,
        "created_at": JAN_1_2024_NOON_TS,
        "updated_at": JAN_1_2024_1201_TS,
        "resolved": True,
        "resolved_at": JAN_1_2024_1202_TS,
        "resolved_by": "account-123",
        "resolved_by_account": AUTHOR_JSON,
        "replies": [
            {
                "id": "reply-1",
                "content": "reply",
                "created_by": "account-456",
                "created_by_account": MENTIONED_JSON,
                "created_at": JAN_1_2024_1203_TS,
            }
        ],
        "mentions": [
            {"mentioned_user_id": "account-456", "mentioned_user_account": MENTIONED_JSON, "reply_id": "reply-1"}
        ],
    }
    _, app_id, comment_id = comments.get_comment.call_args.args
    assert (app_id, comment_id) == (str(APP_ID), "comment-1")


def test_mention_users_requires_the_app_and_lists_workspace_members(
    app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock
) -> None:
    _admit(monkeypatch, TenantAccountRole.NORMAL)
    comments.members.list_members.return_value = [
        SimpleNamespace(
            id="account-456",
            name="mentioned",
            email="mentioned@example.com",
            avatar=None,
            last_login_at=None,
            last_active_at=None,
            created_at=JAN_1_2024_NOON,
            role="normal",
            status="active",
        )
    ]

    with app.test_request_context():
        result = admission(WorkflowCommentMentionUsersApi.get)(None, app_id=APP_ID)

    assert isinstance(result, tuple)
    response, status = result
    assert isinstance(response, dict)
    assert status == 200
    assert [user["id"] for user in response["users"]] == ["account-456"]
    comments.ensure_app.assert_called_once()
    assert comments.ensure_app.call_args.args[1] == str(APP_ID)
    comments.members.list_members.assert_called_once_with(WORKSPACE_ID)


def test_mention_users_rejects_unaddressable_app(
    app: Flask, monkeypatch: pytest.MonkeyPatch, comments: MagicMock
) -> None:
    _admit(monkeypatch, TenantAccountRole.NORMAL)
    comments.ensure_app.side_effect = WorkflowCommentAppNotFoundError

    with app.test_request_context(), pytest.raises(AppNotFoundError):
        admission(WorkflowCommentMentionUsersApi.get)(None, app_id=APP_ID)

    comments.members.list_members.assert_not_called()


@pytest.mark.parametrize(
    ("error", "expected_type", "expected_message"),
    [
        pytest.param(WorkflowCommentAppNotFoundError(), AppNotFoundError, "App not found.", id="app"),
        pytest.param(WorkflowCommentNotFoundError(), NotFoundError, "Comment not found", id="comment"),
        pytest.param(WorkflowCommentReplyNotFoundError(), NotFoundError, "Reply not found", id="reply"),
        pytest.param(
            WorkflowCommentPermissionError("Only the comment creator can update it"),
            ForbiddenError,
            "Only the comment creator can update it",
            id="permission",
        ),
        pytest.param(
            InvalidWorkflowCommentContentError("Comment content cannot be empty"),
            InvalidArgumentError,
            "Comment content cannot be empty",
            id="content",
        ),
        pytest.param(
            InvalidMentionedUserIdError("bad"), InvalidArgumentError, "bad is not a valid uuid.", id="mention-id"
        ),
    ],
)
def test_domain_errors_map_to_existing_transport_errors(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    comments: MagicMock,
    error: Exception,
    expected_type: type[Exception],
    expected_message: str,
) -> None:
    _admit(monkeypatch, TenantAccountRole.EDITOR)
    comments.update_comment.side_effect = error

    with pytest.raises(expected_type) as raised:
        _call(app, UPDATE_COMMENT)

    exception = raised.value
    message = exception.description if isinstance(exception, HTTPException) else str(exception)
    assert message == expected_message


def test_workflow_comment_response_schemas_are_registered() -> None:
    assert workflow_comment_module.WorkflowCommentBasicList.__name__ in console_ns.models
    assert workflow_comment_module.WorkflowCommentDetail.__name__ in console_ns.models
