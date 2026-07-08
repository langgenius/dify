"""Member endpoints under /openapi/v1/workspaces/<id>/...

Coverage:
- Route registration (5 endpoints across 3 URL patterns)
- Body validation lands at 400 (per spec — not Pydantic's default 422)
- Domain exception → HTTP code mapping is preserved with the service's
  original message (so CLI users see what the console user sees)
- Response shape matches the Pydantic models

Auth-pipeline plumbing is bypassed via the `bypass_pipeline` fixture from
conftest.py; the bearer identity is seeded into the openapi auth ContextVar
via `_seed` (the slot `validate_bearer` publishes). Tests that exercise
endpoint *bodies* skip the single `guard_workspace` decorator via
``__wrapped__`` — membership and role enforcement live in the auth pipeline
and are covered in `auth/test_prepare.py` and `auth/test_verify.py`.
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
from flask import Flask
from flask.views import MethodView
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, NotFound, UnprocessableEntity

from controllers.openapi import bp as openapi_bp
from controllers.openapi._errors import MemberLicenseExceeded, MemberLimitExceeded
from controllers.openapi._models import MemberInvitePayload, MemberRoleUpdatePayload
from controllers.openapi.auth.data import AuthData
from controllers.openapi.workspaces import (
    WorkspaceMemberApi,
    WorkspaceMembersApi,
    WorkspaceSwitchApi,
)
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType, reset_auth_ctx, set_auth_ctx
from models.account import AccountStatus, TenantAccountRole
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountNotLinkTenantError,
    AccountRegisterError,
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

# Tokens from `_seed`'s `set_auth_ctx` calls, drained after each test so a
# published identity can't leak into the next (the ContextVar is module-global
# and worker threads are reused). Seed via `_seed(...)`, never `flask.g` —
# production fills the ContextVar, nothing fills `g.auth_ctx`.
_seed_tokens: list = []


def _seed(ctx: AuthContext) -> None:
    _seed_tokens.append(set_auth_ctx(ctx))


@pytest.fixture(autouse=True)
def _reset_auth_ctx():
    yield
    while _seed_tokens:
        reset_auth_ctx(_seed_tokens.pop())


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
        token_type=TokenType.OAUTH_ACCOUNT,
        expires_at=datetime.now(UTC),
        token_hash="h",
        verified_tenants={},
    )


def _auth_data(account_id: uuid.UUID) -> AuthData:
    from controllers.openapi.auth.data import AuthData
    from libs.oauth_bearer import Scope, TokenType

    return AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        account_id=account_id,
        token_hash="testhash",
        scopes=frozenset({Scope.FULL}),
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


def _tenant_service(**overrides) -> SimpleNamespace:
    """TenantService double for the workspaces module.

    Read getters (`get_tenant_by_id`, `find_workspace_for_account`) delegate
    to the session they're handed, so tests keep driving entity loads through
    ``mock_db.session.get`` / ``.execute`` and their existing side_effect
    ordering — the SQL those methods run is covered in test_account_service.py.
    Domain mutators default to no-op Mocks; override per test as needed.
    """
    methods: dict = {
        "switch_tenant": Mock(),
        "get_tenant_members": Mock(return_value=[]),
        "remove_member_from_tenant": Mock(),
        "update_member_role": Mock(),
        "get_tenant_by_id": lambda session, tenant_id: session.get(None, tenant_id),
        "find_workspace_for_account": lambda session, account_id, workspace_id: session.execute(None).first(),
    }
    methods.update(overrides)
    return SimpleNamespace(**methods)


def _account_service(**overrides) -> SimpleNamespace:
    """AccountService double; ``get_account_by_id`` delegates to the injected
    session (see :func:`_tenant_service`)."""
    methods: dict = {
        "get_account_by_id": lambda session, account_id: session.get(None, account_id),
    }
    methods.update(overrides)
    return SimpleNamespace(**methods)


# ---------------------------------------------------------------------------
# Route registration
# ---------------------------------------------------------------------------


def test_switch_route_registered(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/workspaces/<string:workspace_id>:switch")
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
    assert "PATCH" in rule.methods


# ---------------------------------------------------------------------------
# Payload validation lands at 422 (unified via @accepts)
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


def test_invite_rejects_invalid_body_with_422(app: Flask, bypass_pipeline):
    """Invalid invite body → 422 via @accepts (was 400 through _validate_body)."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members",
        method="POST",
        data=json.dumps({"email": "u@example.com", "role": "owner"}),  # owner is not invite-assignable
        content_type="application/json",
    ):
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(UnprocessableEntity):
            api.post.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))


def test_update_role_rejects_invalid_body_with_422(app: Flask, bypass_pipeline):
    """Invalid role-update body surfaces as 422 through @accepts (was 400)."""
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members/{member_id}",
        method="PATCH",
        data=json.dumps({"role": "owner"}),  # closed enum rejects owner
        content_type="application/json",
    ):
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(UnprocessableEntity):
            api.patch.__wrapped__(api, workspace_id=ws_id, member_id=member_id, auth_data=_auth_data(acct_id))


# ---------------------------------------------------------------------------
# Switch endpoint behavior
# ---------------------------------------------------------------------------


def test_switch_returns_workspace_detail_with_current_true(
    app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch
):
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
        _tenant_service(switch_tenant=switch_mock),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(f"/openapi/v1/workspaces/{ws_id}:switch", method="POST"):
        _seed(_auth_ctx(account_id=acct_id))
        body, status = api.post.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))

    assert status == 200
    assert body["id"] == ws_id
    assert body["current"] is True
    assert switch_mock.called


def test_switch_404s_when_service_raises_account_not_link_tenant(
    app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch
):
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
        _tenant_service(switch_tenant=Mock(side_effect=AccountNotLinkTenantError("…"))),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(f"/openapi/v1/workspaces/{ws_id}:switch", method="POST"):
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(NotFound):
            api.post.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))


# ---------------------------------------------------------------------------
# Members list
# ---------------------------------------------------------------------------


def test_members_list_returns_normalized_rows(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
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
        _tenant_service(get_tenant_members=Mock(return_value=[member])),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(f"/openapi/v1/workspaces/{ws_id}/members"):
        _seed(_auth_ctx(account_id=acct_id))
        body, status = api.get.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))

    assert status == 200
    assert body["page"] == 1
    assert body["limit"] == 20
    assert body["total"] == 1
    assert body["has_more"] is False
    assert body["data"][0]["email"] == "mia@example.com"
    assert body["data"][0]["role"] == "admin"
    assert body["data"][0]["status"] == "active"


def test_members_list_paginates_with_query_params(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
    """`?page=2&limit=2` slices service output and reports total/has_more."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    members = [
        SimpleNamespace(
            id=f"m-{i}",
            name=f"User {i}",
            email=f"u{i}@example.com",
            status=AccountStatus.ACTIVE,
            avatar=None,
            role=TenantAccountRole.NORMAL,
        )
        for i in range(5)
    ]

    mock_db = MagicMock()
    mock_db.session.get.return_value = _tenant(ws_id)

    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        _tenant_service(get_tenant_members=Mock(return_value=members)),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(f"/openapi/v1/workspaces/{ws_id}/members?page=2&limit=2"):
        _seed(_auth_ctx(account_id=acct_id))
        body, status = api.get.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))

    assert status == 200
    assert body["page"] == 2
    assert body["limit"] == 2
    assert body["total"] == 5
    assert body["has_more"] is True
    assert [d["id"] for d in body["data"]] == ["m-2", "m-3"]


def test_members_list_rejects_unknown_query_param(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
    """Strict (`extra='forbid'`) — typos like `?pg=2` surface as 422 (unified via @accepts)."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    mock_db = MagicMock()
    mock_db.session.get.return_value = _tenant(ws_id)
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(f"/openapi/v1/workspaces/{ws_id}/members?pg=2"):
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(UnprocessableEntity):
            api.get.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))


# ---------------------------------------------------------------------------
# Invite endpoint
# ---------------------------------------------------------------------------


def test_invite_happy_path_returns_invite_url_and_member_id(
    app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch
):
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
        _account_service(get_account_by_email_with_case_fallback=Mock(return_value=invited)),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members",
        method="POST",
        data=json.dumps({"email": "NEW@example.com", "role": "normal"}),
        content_type="application/json",
    ):
        _seed(_auth_ctx(account_id=acct_id))
        body, status = api.post.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))

    assert status == 201
    assert body["result"] == "success"
    assert body["email"] == "new@example.com"
    assert body["role"] == "normal"
    assert body["member_id"] == "new-1"
    assert "token=tok-123" in body["invite_url"]
    assert "email=new%40example.com" in body["invite_url"]
    assert body["tenant_id"] == ws_id


def _features(
    *,
    billing_enabled: bool = False,
    members_size: int = 0,
    members_limit: int = 0,
    workspace_members_enabled: bool = False,
    workspace_members_size: int = 0,
    workspace_members_limit: int = 0,
) -> SimpleNamespace:
    """Build a feature object matching the surface `_check_member_invite_quota`
    reads: `.billing.enabled`, `.members.{size,limit}`,
    `.workspace_members.{enabled, is_available(N)}`.

    Defaults model CE (both flags off, both caps inert).
    """

    def _is_available(n: int) -> bool:
        return workspace_members_size + n <= workspace_members_limit

    return SimpleNamespace(
        billing=SimpleNamespace(enabled=billing_enabled),
        members=SimpleNamespace(size=members_size, limit=members_limit),
        workspace_members=SimpleNamespace(
            enabled=workspace_members_enabled,
            size=workspace_members_size,
            limit=workspace_members_limit,
            is_available=_is_available,
        ),
    )


def _invite_request(app, ws_id: str, acct_id: uuid.UUID):
    return app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members",
        method="POST",
        data=json.dumps({"email": "new@example.com", "role": "normal"}),
        content_type="application/json",
    )


def test_invite_blocked_by_saas_members_cap(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
    """SaaS billing plan member cap → MemberLimitExceeded (403)."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    mock_db = MagicMock()
    mock_db.session.get.side_effect = [_account(account_id=str(acct_id)), _tenant(ws_id)]

    invite_mock = Mock()
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "RegisterService",
        SimpleNamespace(invite_new_member=invite_mock),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "FeatureService",
        SimpleNamespace(
            get_features=Mock(
                return_value=_features(billing_enabled=True, members_size=10, members_limit=10),
            ),
        ),
    )

    with _invite_request(app, ws_id, acct_id):
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(MemberLimitExceeded):
            api.post.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))

    invite_mock.assert_not_called()


def test_invite_blocked_by_ee_workspace_members_license(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
    """EE License workspace_members cap → MemberLicenseExceeded (403).

    Note: billing.enabled is False (EE without SaaS billing); only the
    license cap fires.
    """
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    mock_db = MagicMock()
    mock_db.session.get.side_effect = [_account(account_id=str(acct_id)), _tenant(ws_id)]

    invite_mock = Mock()
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "RegisterService",
        SimpleNamespace(invite_new_member=invite_mock),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "FeatureService",
        SimpleNamespace(
            get_features=Mock(
                return_value=_features(
                    workspace_members_enabled=True,
                    workspace_members_size=5,
                    workspace_members_limit=5,
                ),
            ),
        ),
    )

    with _invite_request(app, ws_id, acct_id):
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(MemberLicenseExceeded):
            api.post.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))

    invite_mock.assert_not_called()


def test_invite_ce_passes_when_both_caps_disabled(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
    """CE deployment (no billing, no license) → quota gate is a no-op,
    invite proceeds normally."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    invited = _account(account_id="new-1", email="new@example.com")
    mock_db = MagicMock()
    mock_db.session.get.side_effect = [_account(account_id=str(acct_id)), _tenant(ws_id)]

    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "RegisterService",
        SimpleNamespace(invite_new_member=Mock(return_value="tok-ce")),
    )
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "AccountService",
        _account_service(get_account_by_email_with_case_fallback=Mock(return_value=invited)),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "FeatureService",
        SimpleNamespace(get_features=Mock(return_value=_features())),  # all defaults
    )

    with _invite_request(app, ws_id, acct_id):
        _seed(_auth_ctx(account_id=acct_id))
        body, status = api.post.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))

    assert status == 201
    assert body["email"] == "new@example.com"


def test_invite_400_when_already_in_tenant(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
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
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(BadRequest):
            api.post.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))


# ---------------------------------------------------------------------------
# Delete member
# ---------------------------------------------------------------------------


def test_delete_member_happy_path(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    mock_db = MagicMock()
    mock_db.session.get.side_effect = [
        _account(account_id=str(acct_id)),  # operator
        _tenant(ws_id),  # tenant
        _account(account_id=member_id),  # target member
    ]

    remove_mock = Mock()
    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        _tenant_service(remove_member_from_tenant=remove_mock),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members/{member_id}",
        method="DELETE",
    ):
        _seed(_auth_ctx(account_id=acct_id))
        body, status = api.delete.__wrapped__(
            api, workspace_id=ws_id, member_id=member_id, auth_data=_auth_data(acct_id)
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
def test_delete_member_exception_mapping(app: Flask, bypass_pipeline, monkeypatch, exc, expected):
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
        _tenant_service(remove_member_from_tenant=Mock(side_effect=exc)),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members/{member_id}",
        method="DELETE",
    ):
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(expected):
            api.delete.__wrapped__(
                api,
                workspace_id=ws_id,
                member_id=member_id,
                auth_data=_auth_data(acct_id),
            )


def test_delete_member_404_when_member_missing(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
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
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(NotFound):
            api.delete.__wrapped__(
                api,
                workspace_id=ws_id,
                member_id=member_id,
                auth_data=_auth_data(acct_id),
            )


# ---------------------------------------------------------------------------
# Update role
# ---------------------------------------------------------------------------


def test_update_role_happy_path(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

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
        _tenant_service(update_member_role=update_mock),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members/{member_id}",
        method="PATCH",
        data=json.dumps({"role": "admin"}),
        content_type="application/json",
    ):
        _seed(_auth_ctx(account_id=acct_id))
        body, status = api.patch.__wrapped__(
            api, workspace_id=ws_id, member_id=member_id, auth_data=_auth_data(acct_id)
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
def test_update_role_exception_mapping(app: Flask, bypass_pipeline, monkeypatch, exc, expected):
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
        _tenant_service(update_member_role=Mock(side_effect=exc)),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members/{member_id}",
        method="PATCH",
        data=json.dumps({"role": "admin"}),
        content_type="application/json",
    ):
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(expected):
            api.patch.__wrapped__(
                api,
                workspace_id=ws_id,
                member_id=member_id,
                auth_data=_auth_data(acct_id),
            )


# ---------------------------------------------------------------------------
# _load_tenant rejects archived tenant
# ---------------------------------------------------------------------------


def test_load_tenant_rejects_archived_workspace(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
    """Member management against an archived workspace → 404."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    archived = SimpleNamespace(id=ws_id, name="WS", status="archive", created_at=datetime(2026, 5, 18, tzinfo=UTC))
    mock_db = MagicMock()
    mock_db.session.get.return_value = archived

    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "TenantService",
        _tenant_service(),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(f"/openapi/v1/workspaces/{ws_id}/members"):
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(NotFound):
            api.get.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))


# ---------------------------------------------------------------------------
# Invite catches AccountRegisterError
# ---------------------------------------------------------------------------


def test_invite_400_when_register_error(app: Flask, bypass_pipeline, monkeypatch: pytest.MonkeyPatch):
    """AccountRegisterError (frozen email, workspace creation blocked) → 400."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    mock_db = MagicMock()
    mock_db.session.get.side_effect = [_account(account_id=str(acct_id)), _tenant(ws_id)]

    monkeypatch.setattr(
        sys.modules["controllers.openapi.workspaces"],
        "RegisterService",
        SimpleNamespace(
            invite_new_member=Mock(side_effect=AccountRegisterError("Workspace is not allowed to create.")),
        ),
    )
    monkeypatch.setattr(sys.modules["controllers.openapi.workspaces"], "db", mock_db)

    with app.test_request_context(
        f"/openapi/v1/workspaces/{ws_id}/members",
        method="POST",
        data=json.dumps({"email": "frozen@example.com", "role": "normal"}),
        content_type="application/json",
    ):
        _seed(_auth_ctx(account_id=acct_id))
        with pytest.raises(BadRequest):
            api.post.__wrapped__(api, workspace_id=ws_id, auth_data=_auth_data(acct_id))
