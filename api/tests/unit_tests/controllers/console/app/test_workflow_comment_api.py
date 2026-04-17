from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console import wraps as console_wraps
from controllers.console.app import workflow_comment as workflow_comment_module
from controllers.console.app import wraps as app_wraps
from libs import login as login_lib
from models.account import Account, AccountStatus, TenantAccountRole


def _make_account(role: TenantAccountRole) -> Account:
    account = Account(name="tester", email="tester@example.com")
    account.status = AccountStatus.ACTIVE
    account.role = role
    account.id = "account-123"  # type: ignore[assignment]
    account._current_tenant = SimpleNamespace(id="tenant-123")  # type: ignore[attr-defined]
    account._get_current_object = lambda: account  # type: ignore[attr-defined]
    return account


def _make_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-123", tenant_id="tenant-123", status="normal", mode="workflow")


def _patch_console_guards(monkeypatch: pytest.MonkeyPatch, account: Account, app_model: SimpleNamespace) -> None:
    monkeypatch.setattr(login_lib.dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(login_lib, "current_user", account)
    monkeypatch.setattr(login_lib, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(login_lib, "check_csrf_token", lambda *_, **__: None)
    monkeypatch.setattr(console_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(console_wraps.dify_config, "EDITION", "CLOUD")
    monkeypatch.setattr(app_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(app_wraps, "_load_app_model", lambda _app_id: app_model)
    monkeypatch.setattr(workflow_comment_module, "current_user", account)


def _patch_write_services(monkeypatch: pytest.MonkeyPatch) -> None:
    for method_name in (
        "create_comment",
        "update_comment",
        "delete_comment",
        "resolve_comment",
        "validate_comment_access",
        "create_reply",
        "update_reply",
        "delete_reply",
    ):
        monkeypatch.setattr(workflow_comment_module.WorkflowCommentService, method_name, MagicMock())


def _patch_payload(payload: dict[str, object] | None):
    if payload is None:
        return nullcontext()
    return patch.object(
        type(console_ns),
        "payload",
        new_callable=PropertyMock,
        return_value=payload,
    )


@dataclass(frozen=True)
class WriteCase:
    resource_cls: type
    method_name: str
    path: str
    kwargs: dict[str, str]
    payload: dict[str, object] | None = None


@pytest.mark.parametrize(
    "case",
    [
        WriteCase(
            resource_cls=workflow_comment_module.WorkflowCommentListApi,
            method_name="post",
            path="/console/api/apps/app-123/workflow/comments",
            kwargs={"app_id": "app-123"},
            payload={"content": "hello", "position_x": 1.0, "position_y": 2.0, "mentioned_user_ids": []},
        ),
        WriteCase(
            resource_cls=workflow_comment_module.WorkflowCommentDetailApi,
            method_name="put",
            path="/console/api/apps/app-123/workflow/comments/comment-1",
            kwargs={"app_id": "app-123", "comment_id": "comment-1"},
            payload={"content": "hello", "position_x": 1.0, "position_y": 2.0, "mentioned_user_ids": []},
        ),
        WriteCase(
            resource_cls=workflow_comment_module.WorkflowCommentDetailApi,
            method_name="delete",
            path="/console/api/apps/app-123/workflow/comments/comment-1",
            kwargs={"app_id": "app-123", "comment_id": "comment-1"},
        ),
        WriteCase(
            resource_cls=workflow_comment_module.WorkflowCommentResolveApi,
            method_name="post",
            path="/console/api/apps/app-123/workflow/comments/comment-1/resolve",
            kwargs={"app_id": "app-123", "comment_id": "comment-1"},
        ),
        WriteCase(
            resource_cls=workflow_comment_module.WorkflowCommentReplyApi,
            method_name="post",
            path="/console/api/apps/app-123/workflow/comments/comment-1/replies",
            kwargs={"app_id": "app-123", "comment_id": "comment-1"},
            payload={"content": "reply", "mentioned_user_ids": []},
        ),
        WriteCase(
            resource_cls=workflow_comment_module.WorkflowCommentReplyDetailApi,
            method_name="put",
            path="/console/api/apps/app-123/workflow/comments/comment-1/replies/reply-1",
            kwargs={"app_id": "app-123", "comment_id": "comment-1", "reply_id": "reply-1"},
            payload={"content": "reply", "mentioned_user_ids": []},
        ),
        WriteCase(
            resource_cls=workflow_comment_module.WorkflowCommentReplyDetailApi,
            method_name="delete",
            path="/console/api/apps/app-123/workflow/comments/comment-1/replies/reply-1",
            kwargs={"app_id": "app-123", "comment_id": "comment-1", "reply_id": "reply-1"},
        ),
    ],
)
def test_write_endpoints_require_edit_permission(app: Flask, monkeypatch: pytest.MonkeyPatch, case: WriteCase) -> None:
    app.config.setdefault("RESTX_MASK_HEADER", "X-Fields")
    account = _make_account(TenantAccountRole.NORMAL)
    app_model = _make_app()
    _patch_console_guards(monkeypatch, account, app_model)
    _patch_write_services(monkeypatch)

    with app.test_request_context(case.path, method=case.method_name.upper(), json=case.payload):
        with _patch_payload(case.payload):
            handler = getattr(case.resource_cls(), case.method_name)
            with pytest.raises(Forbidden):
                handler(**case.kwargs)


def test_create_comment_allows_editor(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    app.config.setdefault("RESTX_MASK_HEADER", "X-Fields")
    account = _make_account(TenantAccountRole.EDITOR)
    app_model = _make_app()
    _patch_console_guards(monkeypatch, account, app_model)

    create_comment_mock = MagicMock(return_value={"id": "comment-1"})
    monkeypatch.setattr(workflow_comment_module.WorkflowCommentService, "create_comment", create_comment_mock)
    payload = {"content": "hello", "position_x": 1.0, "position_y": 2.0, "mentioned_user_ids": []}

    with app.test_request_context("/console/api/apps/app-123/workflow/comments", method="POST", json=payload):
        with _patch_payload(payload):
            result = workflow_comment_module.WorkflowCommentListApi().post(app_id="app-123")

    if isinstance(result, tuple):
        response = result[0]
    else:
        response = result
    assert response["id"] == "comment-1"
    create_comment_mock.assert_called_once_with(
        tenant_id="tenant-123",
        app_id="app-123",
        created_by="account-123",
        content="hello",
        position_x=1.0,
        position_y=2.0,
        mentioned_user_ids=[],
    )


def test_update_comment_omits_mentions_when_payload_does_not_include_them(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    app.config.setdefault("RESTX_MASK_HEADER", "X-Fields")
    account = _make_account(TenantAccountRole.EDITOR)
    app_model = _make_app()
    _patch_console_guards(monkeypatch, account, app_model)

    update_comment_mock = MagicMock(return_value={"id": "comment-1", "updated_at": datetime(2024, 1, 1, 12, 0, 0)})
    monkeypatch.setattr(workflow_comment_module.WorkflowCommentService, "update_comment", update_comment_mock)
    payload = {"content": "hello", "position_x": 10.0, "position_y": 20.0}

    with app.test_request_context("/console/api/apps/app-123/workflow/comments/comment-1", method="PUT", json=payload):
        with _patch_payload(payload):
            workflow_comment_module.WorkflowCommentDetailApi().put(app_id="app-123", comment_id="comment-1")

    update_comment_mock.assert_called_once_with(
        tenant_id="tenant-123",
        app_id="app-123",
        comment_id="comment-1",
        user_id="account-123",
        content="hello",
        position_x=10.0,
        position_y=20.0,
        mentioned_user_ids=None,
    )
