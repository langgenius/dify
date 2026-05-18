"""Member endpoints under /openapi/v1/workspaces/<id>/...

Coverage:
- Route registration (5 endpoints across 4 URL patterns)
- Body validation lands at 400 (per spec — not Pydantic's default 422)
- Domain exception → HTTP code mapping is preserved with the service's
  original message (so CLI users see what the console user sees)
- Response shape matches the Pydantic models

Auth-pipeline plumbing is bypassed via the `bypass_pipeline` fixture from
conftest.py; `g.auth_ctx` is seeded manually, and the role gate's DB lookup
is mocked. Tests that exercise endpoint *bodies* skip the decorators via
``__wrapped__`` since those layers are covered in `auth/test_role_gate.py`.
"""

from __future__ import annotations

import builtins
import json
import sys
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest
from flask import Flask, g
from flask.views import MethodView
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, NotFound

from controllers.openapi import bp as openapi_bp
from controllers.openapi._models import MemberInvitePayload, MemberRoleUpdatePayload
from controllers.openapi.workspaces import (
    WorkspaceMemberApi,
    WorkspaceMemberRoleApi,
    WorkspaceMembersApi,
    WorkspaceSwitchApi,
)
from libs.oauth_bearer import AuthContext, Scope, SubjectType
from models.account import AccountStatus, TenantAccountRole
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountNotLinkTenantError,
    CannotOperateSelfError,
    MemberNotInTenantError,
    NoPermissionError,
    RoleAlreadyAssignedError,
)

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def openapi_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


def _rule(app: Flask, path: str):
    return next(r for r in app.url_map.iter_rules() if r.rule == path)


def _auth_ctx(account_id: uuid.UUID | None = None) -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="caller@example.com",
        subject_issuer="dify:account",
        account_id=account_id or uuid.uuid4(),
        client_id="difyctl",
        scopes=frozenset({Scope.FULL}),
        token_id=uuid.uuid4(),
        source="oauth_account",
        expires_at=datetime.now(UTC),
        token_hash="h",
        verified_tenants={},
    )


def _account(account_id: str = "acct-1", email: str = "u@example.com") -> SimpleNamespace:
    return SimpleNamespace(
        id=account_id,
        name="User",
        email=email,
        status=AccountStatus.ACTIVE,
        avatar=None,
    )


def _tenant(tenant_id: str = "ws-1") -> SimpleNamespace:
    return SimpleNamespace(
        id=tenant_id,
        name="WS",
        status="normal",
        created_at=datetime(2026, 5, 18, tzinfo=UTC),
    )


# ---------------------------------------------------------------------------
# Route registration
# ---------------------------------------------------------------------------


def test_switch_route_registered(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/workspaces/<string:workspace_id>/switch")
    assert openapi_app.view_functions[rule.endpoint].view_class is WorkspaceSwitchApi
    assert "POST" in rule.methods


def test_members_route_registered(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/workspaces/<string:workspace_id>/members")
    assert openapi_app.view_functions[rule.endpoint].view_class is WorkspaceMembersApi
    assert "GET" in rule.methods
    assert "POST" in rule.methods


def test_member_by_id_route_registered(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/workspaces/<string:workspace_id>/members/<string:member_id>")
    assert openapi_app.view_functions[rule.endpoint].view_class is WorkspaceMemberApi
    assert "DELETE" in rule.methods


def test_member_role_route_registered(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/workspaces/<string:workspace_id>/members/<string:member_id>/role")
    assert openapi_app.view_functions[rule.endpoint].view_class is WorkspaceMemberRoleApi
    assert "PUT" in rule.methods


# ---------------------------------------------------------------------------
# Payload validation lands at 400
# ---------------------------------------------------------------------------


def test_invite_payload_rejects_unknown_role():
    with pytest.raises(ValidationError):
        MemberInvitePayload.model_validate({"email": "u@example.com", "role": "owner"})


def test_invite_payload_rejects_bad_email():
    with pytest.raises(ValidationError):
        MemberInvitePayload.model_validate({"email": "not-an-email", "role": "normal"})


def test_invite_payload_rejects_extra_field():
    with pytest.raises(ValidationError):
        MemberInvitePayload.model_validate({"email": "u@example.com", "role": "normal", "extra": "x"})


def test_role_payload_rejects_owner():
    with pytest.raises(ValidationError):
        MemberRoleUpdatePayload.model_validate({"role": "owner"})


def test_role_payload_rejects_extra_field():
    with pytest.raises(ValidationError):
        MemberRoleUpdatePayload.model_validate({"role": "normal", "extra": "x"})


def test_validate_body_helper_maps_validation_error_to_400(app, monkeypatch):
    """`_validate_body` is the centralized 400-mapper for invalid request bodies."""
    from controllers.openapi.workspaces import _validate_body

    with app.test_request_context(
        "/openapi/v1/workspaces/ws-1/members",
        method="POST",
        data=json.dumps({"email": "u@example.com", "role": "owner"}),
        content_type="application/json",
    ):
        with pytest.raises(BadRequest):
            _validate_body(MemberInvitePayload)


# ---------------------------------------------------------------------------
# Switch endpoint behavior
# ---------------------------------------------------------------------------


def test_switch_returns_workspace_detail_with_current_true(app, bypass_pipeline, monkeypatch):
    """Happy path: switch service is called, then the workspace+membership
    row is re-queried so the returned `current` reflects post-commit state.
    """
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceSwitchApi()

    mock_db = MagicMock()
    mock_db.session.get.return_value = _account(account_id=str(acct_id))
    membership = SimpleNamespace(role=TenantAccountRole.OWNER, current=True)
    mock_db.session.execute.return_value.first.return_value = (_tenant(ws_id), membership)

    switch_mock = Mock()
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        SimpleNamespace(
            switch_tenant=switch_mock,
            get_tenant_members=Mock(return_value=[]),
            remove_member_from_tenant=Mock(),
            update_member_role=Mock(),
        ),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(f"/openapi/v1/workspaces/{ws_id}/switch", method="POST"):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        body, status = api.post.__wrapped__.__wrapped__.__wrapped__(api, workspace_id=ws_id)

    assert status == 200
    assert body["id"] == ws_id
    assert body["current"] is True
    assert switch_mock.called


def test_switch_404s_when_service_raises_account_not_link_tenant(app, bypass_pipeline, monkeypatch):
    """If switch_tenant raises (e.g. Tenant.status != NORMAL), the body
    surfaces as NotFound, not 500."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceSwitchApi()

    mock_db = MagicMock()
    mock_db.session.get.return_value = _account(account_id=str(acct_id))

    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        SimpleNamespace(
            switch_tenant=Mock(side_effect=AccountNotLinkTenantError("…")),
            get_tenant_members=Mock(),
            remove_member_from_tenant=Mock(),
            update_member_role=Mock(),
        ),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(f"/openapi/v1/workspaces/{ws_id}/switch", method="POST"):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        with pytest.raises(NotFound):
            api.post.__wrapped__.__wrapped__.__wrapped__(api, workspace_id=ws_id)


# ---------------------------------------------------------------------------
# Members list
# ---------------------------------------------------------------------------


def test_members_list_returns_normalized_rows(app, bypass_pipeline, monkeypatch):
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    member = SimpleNamespace(
        id="m-1",
        name="Mia",
        email="mia@example.com",
        status=AccountStatus.ACTIVE,
        avatar=None,
        role=TenantAccountRole.ADMIN,
    )

    mock_db = MagicMock()
    mock_db.session.get.return_value = _tenant(ws_id)

    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        SimpleNamespace(
            switch_tenant=Mock(),
            get_tenant_members=Mock(return_value=[member]),
            remove_member_from_tenant=Mock(),
            update_member_role=Mock(),
        ),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(f"/openapi/v1/workspaces/{ws_id}/members"):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        body, status = api.get.__wrapped__.__wrapped__.__wrapped__(api, workspace_id=ws_id)

    assert status == 200
    assert body["members"][0]["email"] == "mia@example.com"
    assert body["members"][0]["role"] == "admin"
    assert body["members"][0]["status"] == "active"


# ---------------------------------------------------------------------------
# Invite endpoint
# ---------------------------------------------------------------------------


def test_invite_happy_path_returns_invite_url_and_member_id(app, bypass_pipeline, monkeypatch):
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    invited = _account(account_id="new-1", email="new@example.com")

    mock_db = MagicMock()
    # session.get is called twice: once for inviter Account, once for Tenant
    mock_db.session.get.side_effect = [_account(account_id=str(acct_id)), _tenant(ws_id)]

    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "RegisterService",
        SimpleNamespace(invite_new_member=Mock(return_value="tok-123")),
    )
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "AccountService",
        SimpleNamespace(get_account_by_email_with_case_fallback=Mock(return_value=invited)),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members",
        method="POST",
        data=json.dumps({"email": "NEW@example.com", "role": "normal"}),
        content_type="application/json",
    ):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        body, status = api.post.__wrapped__.__wrapped__.__wrapped__(api, workspace_id=ws_id)

    assert status == 201
    assert body["result"] == "success"
    assert body["email"] == "new@example.com"
    assert body["role"] == "normal"
    assert body["member_id"] == "new-1"
    assert "token=tok-123" in body["invite_url"]
    assert "email=new%40example.com" in body["invite_url"]
    assert body["tenant_id"] == ws_id


def test_invite_400_when_already_in_tenant(app, bypass_pipeline, monkeypatch):
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    mock_db = MagicMock()
    mock_db.session.get.side_effect = [_account(account_id=str(acct_id)), _tenant(ws_id)]

    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "RegisterService",
        SimpleNamespace(invite_new_member=Mock(side_effect=AccountAlreadyInTenantError("already in tenant"))),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members",
        method="POST",
        data=json.dumps({"email": "u@example.com", "role": "normal"}),
        content_type="application/json",
    ):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        with pytest.raises(BadRequest):
            api.post.__wrapped__.__wrapped__.__wrapped__(api, workspace_id=ws_id)


# ---------------------------------------------------------------------------
# Delete member
# ---------------------------------------------------------------------------


def test_delete_member_happy_path(app, bypass_pipeline, monkeypatch):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    mock_db = MagicMock()
    mock_db.session.get.side_effect = [
        _account(account_id=str(acct_id)),  # operator
        _tenant(ws_id),                     # tenant
        _account(account_id=member_id),     # target member
    ]

    remove_mock = Mock()
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        SimpleNamespace(
            switch_tenant=Mock(),
            get_tenant_members=Mock(),
            remove_member_from_tenant=remove_mock,
            update_member_role=Mock(),
        ),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members/{member_id}",
        method="DELETE",
    ):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        body, status = api.delete.__wrapped__.__wrapped__.__wrapped__(
            api,
            workspace_id=ws_id,
            member_id=member_id,
        )

    assert status == 200
    assert body == {"result": "success"}
    assert remove_mock.called


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (CannotOperateSelfError("cannot operate self"), BadRequest),
        (NoPermissionError("no permission"), BadRequest),
        (MemberNotInTenantError("not in tenant"), NotFound),
    ],
)
def test_delete_member_exception_mapping(app, bypass_pipeline, monkeypatch, exc, expected):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    mock_db = MagicMock()
    mock_db.session.get.side_effect = [
        _account(account_id=str(acct_id)),
        _tenant(ws_id),
        _account(account_id=member_id),
    ]

    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        SimpleNamespace(
            switch_tenant=Mock(),
            get_tenant_members=Mock(),
            remove_member_from_tenant=Mock(side_effect=exc),
            update_member_role=Mock(),
        ),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members/{member_id}",
        method="DELETE",
    ):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        with pytest.raises(expected):
            api.delete.__wrapped__.__wrapped__.__wrapped__(
                api,
                workspace_id=ws_id,
                member_id=member_id,
            )


def test_delete_member_404_when_member_missing(app, bypass_pipeline, monkeypatch):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    mock_db = MagicMock()
    mock_db.session.get.side_effect = [
        _account(account_id=str(acct_id)),
        _tenant(ws_id),
        None,  # member not found
    ]
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members/{member_id}",
        method="DELETE",
    ):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        with pytest.raises(NotFound):
            api.delete.__wrapped__.__wrapped__.__wrapped__(
                api,
                workspace_id=ws_id,
                member_id=member_id,
            )


# ---------------------------------------------------------------------------
# Update role
# ---------------------------------------------------------------------------


def test_update_role_happy_path(app, bypass_pipeline, monkeypatch):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberRoleApi()

    mock_db = MagicMock()
    mock_db.session.get.side_effect = [
        _account(account_id=str(acct_id)),
        _tenant(ws_id),
        _account(account_id=member_id),
    ]

    update_mock = Mock()
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        SimpleNamespace(
            switch_tenant=Mock(),
            get_tenant_members=Mock(),
            remove_member_from_tenant=Mock(),
            update_member_role=update_mock,
        ),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members/{member_id}/role",
        method="PUT",
        data=json.dumps({"role": "admin"}),
        content_type="application/json",
    ):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        body, status = api.put.__wrapped__.__wrapped__.__wrapped__(
            api,
            workspace_id=ws_id,
            member_id=member_id,
        )

    assert status == 200
    assert body == {"result": "success"}
    args = update_mock.call_args.args
    assert args[2] == "admin"


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (CannotOperateSelfError("cannot operate self"), BadRequest),
        (NoPermissionError("no permission"), BadRequest),
        (RoleAlreadyAssignedError("already"), BadRequest),
        (MemberNotInTenantError("not in tenant"), NotFound),
    ],
)
def test_update_role_exception_mapping(app, bypass_pipeline, monkeypatch, exc, expected):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberRoleApi()

    mock_db = MagicMock()
    mock_db.session.get.side_effect = [
        _account(account_id=str(acct_id)),
        _tenant(ws_id),
        _account(account_id=member_id),
    ]

    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        SimpleNamespace(
            switch_tenant=Mock(),
            get_tenant_members=Mock(),
            remove_member_from_tenant=Mock(),
            update_member_role=Mock(side_effect=exc),
        ),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members/{member_id}/role",
        method="PUT",
        data=json.dumps({"role": "admin"}),
        content_type="application/json",
    ):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        with pytest.raises(expected):
            api.put.__wrapped__.__wrapped__.__wrapped__(
                api,
                workspace_id=ws_id,
                member_id=member_id,
            )


# ---------------------------------------------------------------------------
# Role gate composition — non-member sees 404 even with valid bearer
# ---------------------------------------------------------------------------


def test_non_member_caller_gets_404_on_switch(app, bypass_pipeline, monkeypatch):
    """End-to-end: caller has valid account bearer but no membership in
    the requested workspace. The role gate must short-circuit to 404
    before any TenantService method is touched."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceSwitchApi()

    mock_db = MagicMock()
    mock_db.session.execute.return_value.scalar_one_or_none.return_value = None

    switch_mock = Mock()
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        SimpleNamespace(
            switch_tenant=switch_mock,
            get_tenant_members=Mock(),
            remove_member_from_tenant=Mock(),
            update_member_role=Mock(),
        ),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)
    monkeypatch.setattr(sys.modules["controllers.openapi.auth.role_gate"], "db", mock_db)

    with app.test_request_context(f"/openapi/v1/workspaces/{ws_id}/switch", method="POST"):
        g.auth_ctx = _auth_ctx(account_id=acct_id)
        # Strip only the bearer + surface-gate wrappers; keep the role gate.
        # Decorator stack (innermost → outermost):
        #   role_gate → accept_subjects → validate_bearer
        # So `post.__wrapped__` unwraps validate_bearer; we then unwrap
        # accept_subjects to land on the role-gate wrapper.
        gated = api.post.__wrapped__.__wrapped__
        with pytest.raises(NotFound):
            gated(api, workspace_id=ws_id)

    switch_mock.assert_not_called()
