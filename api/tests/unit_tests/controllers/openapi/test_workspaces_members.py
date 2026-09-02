"""Member endpoints under /openapi/v1/workspaces/<id>/...

Coverage:
- Route registration (5 endpoints across 3 URL patterns)
- Payload validation lands at 422 on the wire (unified via @accepts)
- Domain exception → HTTP code mapping is preserved with the service's
  original message (so CLI users see what the console user sees)
- Response shape matches the Pydantic models
- The invite route actually commits its unit of work

Auth is not exercised here: `@endpoint` resolves the `Context` before the
handler runs, and the allow/deny answers live in `test_auth_matrix.py`. Body
tests call `__handler__` — the one seam — with a real `Context` over the test
database. The 422 tests cannot use it, because `@accepts` sits inside the guard
and `__handler__` is below it; they go over the wire through `admitted_bearer`
instead, and assert the canonical `ErrorBody` a client actually receives.
"""

from __future__ import annotations

import builtins
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from flask.views import MethodView
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import BadRequest, NotFound
from werkzeug.test import TestResponse

from controllers.openapi import bp as openapi_bp
from controllers.openapi import workspaces as workspaces_module
from controllers.openapi._errors import (
    ErrorBody,
    MemberLicenseExceeded,
    MemberLimitExceeded,
    OpenApiErrorCode,
)
from controllers.openapi._models import MemberInvitePayload, MemberListQuery, MemberRoleUpdatePayload
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_caller, load_workspace
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.workspaces import (
    WorkspaceMemberApi,
    WorkspaceMembersApi,
    WorkspaceSwitchApi,
)
from libs.oauth_bearer import AuthContext, TokenType
from models import Account, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from services.account_service import TenantService as RealTenantService
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountNotLinkTenantError,
    AccountRegisterError,
    CannotOperateSelfError,
    MemberNotInTenantError,
    NoPermissionError,
    RoleAlreadyAssignedError,
)
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld

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


@pytest.fixture
def database_session(sqlite_session: Session):
    return sqlite_session


def _rule(app: Flask, path: str):
    return next(r for r in app.url_map.iter_rules() if r.rule == path)


def _auth_ctx(account_id: uuid.UUID | None = None) -> AuthContext:
    return AuthContext(
        subject_email="caller@example.com",
        subject_issuer="dify:account",
        account_id=account_id or uuid.uuid4(),
        client_id="difyctl",
        token_id=uuid.uuid4(),
        token_type=TokenType.OAUTH_ACCOUNT,
        expires_at=datetime.now(UTC),
    )


def _context(session: Session, account_id: uuid.UUID, workspace_id: str) -> Context:
    """The context a handler is given *after* the pipeline ran: the caller's
    subject, the request's session and its path params, plus the workspace and
    caller these routes' requirements load off the same rows.
    """
    ctx = Context(AccountSubject(_auth_ctx(account_id)), session, {"workspace_id": workspace_id})
    load_workspace(ctx)
    load_caller(ctx)
    return ctx


def _account(account_id: str = "acct-1", email: str = "u@example.com") -> Account:
    account = Account(name="User", email=email, status=AccountStatus.ACTIVE)
    account.id = account_id
    return account


def _tenant(tenant_id: str = "ws-1", *, status: TenantStatus = TenantStatus.NORMAL) -> Tenant:
    tenant = Tenant(name="WS", status=status)
    tenant.id = tenant_id
    tenant.created_at = datetime(2026, 5, 18)
    return tenant


def _persist_workspace(
    session: Session,
    workspace_id: str,
    memberships: list[tuple[str, str, TenantAccountRole, bool]],
    *,
    status: TenantStatus = TenantStatus.NORMAL,
) -> tuple[Tenant, list[Account]]:
    tenant = _tenant(workspace_id, status=status)
    accounts: list[Account] = []
    session.add(tenant)
    for account_id, email, role, current in memberships:
        account = _account(account_id=account_id, email=email)
        membership = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            current=current,
            role=role,
        )
        accounts.append(account)
        session.add_all([account, membership])
    session.commit()
    return tenant, accounts


def _persist_caller(session: Session, account_id: uuid.UUID) -> None:
    """These routes all declare `CheckWorkspaceMember`, which resolves the
    caller, so a handler reached through `__handler__` needs the caller's row
    even when its own body only reads the workspace.
    """
    session.add(_account(account_id=str(account_id), email="caller@example.com"))
    session.commit()


def _tenant_service(**overrides) -> SimpleNamespace:
    """Retain domain mutator doubles while delegating reads to the real service."""
    methods: dict = {
        "switch_tenant": RealTenantService.switch_tenant,
        "get_tenant_members": RealTenantService.get_tenant_members,
        "remove_member_from_tenant": Mock(),
        "update_member_role": Mock(),
        "get_tenant_by_id": RealTenantService.get_tenant_by_id,
        "find_workspace_for_account": RealTenantService.find_workspace_for_account,
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
# Payload validation lands at 422 on the wire (unified via @accepts)
# ---------------------------------------------------------------------------


def _assert_validation_422(resp: TestResponse) -> None:
    """The wire contract for a rejected payload: 422 carrying the canonical body."""
    assert resp.status_code == 422, resp.get_json()
    wire = resp.get_json()
    ErrorBody.model_validate(wire)
    assert wire["code"] == OpenApiErrorCode.INVALID_PARAM
    assert wire["details"]


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


def test_invite_rejects_invalid_body_with_422(admitted_bearer: AdmittedWorld):
    """Invalid invite body → 422 on the wire, from `@accepts` inside the guard."""
    resp = admitted_bearer.client.post(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/members",
        json={"email": "u@example.com", "role": "owner"},  # owner is not invite-assignable
        headers=admitted_bearer.headers,
    )

    _assert_validation_422(resp)


def test_update_role_rejects_invalid_body_with_422(admitted_bearer: AdmittedWorld):
    """Invalid role-update body surfaces as 422 through @accepts."""
    resp = admitted_bearer.client.patch(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/members/{admitted_bearer.member_id}",
        json={"role": "owner"},  # closed enum rejects owner
        headers=admitted_bearer.headers,
    )

    _assert_validation_422(resp)


def test_members_list_rejects_unknown_query_param(admitted_bearer: AdmittedWorld):
    """Strict (`extra='forbid'`) — typos like `?pg=2` surface as 422."""
    resp = admitted_bearer.client.get(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/members?pg=2",
        headers=admitted_bearer.headers,
    )

    _assert_validation_422(resp)


# ---------------------------------------------------------------------------
# Switch endpoint behavior
# ---------------------------------------------------------------------------


def test_switch_returns_workspace_detail_with_current_true(database_session: Session):
    """Happy path: switch service is called, then the workspace+membership
    row is re-queried so the returned `current` reflects post-commit state.
    """
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceSwitchApi()

    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, False)],
    )

    result = api.post.__handler__(api, _context(database_session, acct_id, ws_id), workspace_id=ws_id)

    assert result.id == ws_id
    assert result.current is True
    membership = database_session.scalar(
        select(TenantAccountJoin).where(
            TenantAccountJoin.tenant_id == ws_id,
            TenantAccountJoin.account_id == str(acct_id),
        )
    )
    assert membership is not None
    assert membership.current is True


def test_switch_404s_when_service_raises_account_not_link_tenant(
    monkeypatch: pytest.MonkeyPatch, database_session: Session
):
    """If switch_tenant raises (e.g. Tenant.status != NORMAL), the body
    surfaces as NotFound, not 500."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceSwitchApi()

    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, False)],
    )

    monkeypatch.setattr(
        workspaces_module,
        "TenantService",
        _tenant_service(switch_tenant=Mock(side_effect=AccountNotLinkTenantError("…"))),
    )

    with pytest.raises(NotFound):
        api.post.__handler__(api, _context(database_session, acct_id, ws_id), workspace_id=ws_id)


# ---------------------------------------------------------------------------
# Members list
# ---------------------------------------------------------------------------


def test_members_list_returns_normalized_rows(database_session: Session):
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    member_id = str(uuid.uuid4())
    api = WorkspaceMembersApi()

    _, members = _persist_workspace(
        database_session,
        ws_id,
        [(member_id, "mia@example.com", TenantAccountRole.ADMIN, False)],
    )
    members[0].name = "Mia"
    _persist_caller(database_session, acct_id)

    result = api.get.__handler__(
        api,
        _context(database_session, acct_id, ws_id),
        workspace_id=ws_id,
        query=MemberListQuery(),
    )

    assert result.page == 1
    assert result.limit == 20
    assert result.total == 1
    assert result.has_more is False
    assert result.data[0].email == "mia@example.com"
    assert result.data[0].role == "admin"
    assert result.data[0].status == "active"


def test_members_list_paginates_with_query_params(database_session: Session):
    """`page=2&limit=2` slices service output and reports total/has_more."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    member_ids = [str(uuid.uuid4()) for _ in range(5)]
    memberships = [(member_ids[i], f"u{i}@example.com", TenantAccountRole.NORMAL, False) for i in range(5)]
    _persist_workspace(database_session, ws_id, memberships)
    _persist_caller(database_session, acct_id)

    result = api.get.__handler__(
        api,
        _context(database_session, acct_id, ws_id),
        workspace_id=ws_id,
        query=MemberListQuery(page=2, limit=2),
    )

    assert result.page == 2
    assert result.limit == 2
    assert result.total == 5
    assert result.has_more is True
    assert [d.id for d in result.data] == member_ids[2:4]


def test_members_list_404s_on_an_archived_workspace(database_session: Session):
    """Member management against an archived workspace → 404, raised by
    `load_workspace` before the handler is entered — which is where the real
    route raises it too, since `CheckWorkspaceMember` loads the workspace
    at `EARLY`. The handler body is no longer reached, so this no longer pins
    anything about it.
    """
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    _persist_workspace(database_session, ws_id, [], status=TenantStatus.ARCHIVE)

    with pytest.raises(NotFound):
        api.get.__handler__(
            api,
            _context(database_session, acct_id, ws_id),
            workspace_id=ws_id,
            query=MemberListQuery(),
        )


# ---------------------------------------------------------------------------
# Invite endpoint
# ---------------------------------------------------------------------------


def _invite_body(email: str = "new@example.com") -> MemberInvitePayload:
    return MemberInvitePayload(email=email, role="normal")


def test_invite_happy_path_returns_invite_url_and_member_id(monkeypatch: pytest.MonkeyPatch, database_session: Session):
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    invited_id = str(uuid.uuid4())
    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
    )
    database_session.add(_account(account_id=invited_id, email="new@example.com"))
    database_session.commit()

    monkeypatch.setattr(
        workspaces_module,
        "RegisterService",
        SimpleNamespace(invite_new_member=Mock(return_value="tok-123")),
    )

    result = api.post.__handler__(
        api,
        _context(database_session, acct_id, ws_id),
        workspace_id=ws_id,
        body=_invite_body("NEW@example.com"),
    )

    assert result.result == "success"
    assert result.email == "new@example.com"
    assert result.role == "normal"
    assert result.member_id == invited_id
    assert "token=tok-123" in result.invite_url
    assert "email=new%40example.com" in result.invite_url
    assert result.tenant_id == ws_id


def test_invite_commits_the_invitation(
    openapi_app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
):
    """The one route where a wrong `write=` is silent data loss rather than a
    wrong status: `RegisterService.invite_new_member` carries no commit of its
    own, so the invitation persists only because the route declares `write=True`
    and the router commits the request's session. The double stands in for that
    contract — it writes through the session it is handed and returns a token —
    so this fails if the route ever declares `write=False`.
    """
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    invited_id = str(uuid.uuid4())

    with sqlite_session_factory() as setup:
        _persist_workspace(
            setup,
            ws_id,
            [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
        )
        setup.add(_account(account_id=invited_id, email="new@example.com"))
        setup.commit()

    def _invite(*, tenant, email, language, role, inviter, session) -> str:
        session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=invited_id, role=TenantAccountRole.NORMAL))
        return "tok-persist"

    monkeypatch.setattr(workspaces_module, "RegisterService", SimpleNamespace(invite_new_member=_invite))
    monkeypatch.setattr(
        "controllers.openapi.auth.router.get_authenticator",
        lambda: SimpleNamespace(authenticate=lambda _token: _auth_ctx(acct_id)),
    )
    monkeypatch.setattr("controllers.openapi.auth.pipelines._mount_flask_login", lambda _user: None)

    response = openapi_app.test_client().post(
        f"/openapi/v1/workspaces/{ws_id}/members",
        json={"email": "new@example.com", "role": "normal"},
        headers={"Authorization": "Bearer dfoa_matrix"},
    )

    assert response.status_code == 201, response.get_json()
    with sqlite_session_factory() as verify:
        persisted = verify.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == ws_id,
                TenantAccountJoin.account_id == invited_id,
            )
        )
    assert persisted is not None


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


def test_invite_blocked_by_saas_members_cap(monkeypatch: pytest.MonkeyPatch, database_session: Session):
    """SaaS billing plan member cap → MemberLimitExceeded (403)."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
    )

    invite_mock = Mock()
    monkeypatch.setattr(
        workspaces_module,
        "RegisterService",
        SimpleNamespace(invite_new_member=invite_mock),
    )
    monkeypatch.setattr(
        workspaces_module,
        "FeatureService",
        SimpleNamespace(
            get_features=Mock(
                return_value=_features(billing_enabled=True, members_size=10, members_limit=10),
            ),
        ),
    )

    with pytest.raises(MemberLimitExceeded):
        api.post.__handler__(api, _context(database_session, acct_id, ws_id), workspace_id=ws_id, body=_invite_body())

    invite_mock.assert_not_called()


def test_invite_blocked_by_ee_workspace_members_license(monkeypatch: pytest.MonkeyPatch, database_session: Session):
    """EE License workspace_members cap → MemberLicenseExceeded (403).

    Note: billing.enabled is False (EE without SaaS billing); only the
    license cap fires.
    """
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
    )

    invite_mock = Mock()
    monkeypatch.setattr(
        workspaces_module,
        "RegisterService",
        SimpleNamespace(invite_new_member=invite_mock),
    )
    monkeypatch.setattr(
        workspaces_module,
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

    with pytest.raises(MemberLicenseExceeded):
        api.post.__handler__(api, _context(database_session, acct_id, ws_id), workspace_id=ws_id, body=_invite_body())

    invite_mock.assert_not_called()


def test_invite_ce_passes_when_both_caps_disabled(monkeypatch: pytest.MonkeyPatch, database_session: Session):
    """CE deployment (no billing, no license) → quota gate is a no-op,
    invite proceeds normally."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    invited_id = str(uuid.uuid4())
    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
    )
    database_session.add(_account(account_id=invited_id, email="new@example.com"))
    database_session.commit()

    monkeypatch.setattr(
        workspaces_module,
        "RegisterService",
        SimpleNamespace(invite_new_member=Mock(return_value="tok-ce")),
    )
    monkeypatch.setattr(
        workspaces_module,
        "FeatureService",
        SimpleNamespace(get_features=Mock(return_value=_features())),  # all defaults
    )

    result = api.post.__handler__(
        api, _context(database_session, acct_id, ws_id), workspace_id=ws_id, body=_invite_body()
    )

    assert result.email == "new@example.com"


def test_invite_400_when_already_in_tenant(monkeypatch: pytest.MonkeyPatch, database_session: Session):
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
    )

    monkeypatch.setattr(
        workspaces_module,
        "RegisterService",
        SimpleNamespace(invite_new_member=Mock(side_effect=AccountAlreadyInTenantError("already in tenant"))),
    )

    with pytest.raises(BadRequest):
        api.post.__handler__(
            api,
            _context(database_session, acct_id, ws_id),
            workspace_id=ws_id,
            body=_invite_body("u@example.com"),
        )


def test_invite_400_when_register_error(monkeypatch: pytest.MonkeyPatch, database_session: Session):
    """AccountRegisterError (frozen email, workspace creation blocked) → 400."""
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
    )

    monkeypatch.setattr(
        workspaces_module,
        "RegisterService",
        SimpleNamespace(
            invite_new_member=Mock(side_effect=AccountRegisterError("Workspace is not allowed to create.")),
        ),
    )

    with pytest.raises(BadRequest):
        api.post.__handler__(
            api,
            _context(database_session, acct_id, ws_id),
            workspace_id=ws_id,
            body=_invite_body("frozen@example.com"),
        )


# ---------------------------------------------------------------------------
# Delete member
# ---------------------------------------------------------------------------


def test_delete_member_happy_path(monkeypatch: pytest.MonkeyPatch, database_session: Session):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    _persist_workspace(
        database_session,
        ws_id,
        [
            (str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True),
            (member_id, "member@example.com", TenantAccountRole.NORMAL, False),
        ],
    )

    remove_mock = Mock()
    monkeypatch.setattr(
        workspaces_module,
        "TenantService",
        _tenant_service(remove_member_from_tenant=remove_mock),
    )

    result = api.delete.__handler__(
        api, _context(database_session, acct_id, ws_id), workspace_id=ws_id, member_id=member_id
    )

    assert result.result == "success"
    assert remove_mock.called


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (CannotOperateSelfError("cannot operate self"), BadRequest),
        (NoPermissionError("no permission"), BadRequest),
        (MemberNotInTenantError("not in tenant"), NotFound),
    ],
)
def test_delete_member_exception_mapping(monkeypatch, exc, expected, database_session: Session):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    _persist_workspace(
        database_session,
        ws_id,
        [
            (str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True),
            (member_id, "member@example.com", TenantAccountRole.NORMAL, False),
        ],
    )

    monkeypatch.setattr(
        workspaces_module,
        "TenantService",
        _tenant_service(remove_member_from_tenant=Mock(side_effect=exc)),
    )

    with pytest.raises(expected):
        api.delete.__handler__(api, _context(database_session, acct_id, ws_id), workspace_id=ws_id, member_id=member_id)


def test_delete_member_404_when_member_missing(database_session: Session):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
    )

    with pytest.raises(NotFound):
        api.delete.__handler__(api, _context(database_session, acct_id, ws_id), workspace_id=ws_id, member_id=member_id)


# ---------------------------------------------------------------------------
# Update role
# ---------------------------------------------------------------------------


def test_update_role_happy_path(monkeypatch: pytest.MonkeyPatch, database_session: Session):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    _persist_workspace(
        database_session,
        ws_id,
        [
            (str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True),
            (member_id, "member@example.com", TenantAccountRole.NORMAL, False),
        ],
    )

    update_mock = Mock()
    monkeypatch.setattr(
        workspaces_module,
        "TenantService",
        _tenant_service(update_member_role=update_mock),
    )

    result = api.patch.__handler__(
        api,
        _context(database_session, acct_id, ws_id),
        workspace_id=ws_id,
        member_id=member_id,
        body=MemberRoleUpdatePayload(role="admin"),
    )

    assert result.result == "success"
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
def test_update_role_exception_mapping(monkeypatch, exc, expected, database_session: Session):
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    _persist_workspace(
        database_session,
        ws_id,
        [
            (str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True),
            (member_id, "member@example.com", TenantAccountRole.NORMAL, False),
        ],
    )

    monkeypatch.setattr(
        workspaces_module,
        "TenantService",
        _tenant_service(update_member_role=Mock(side_effect=exc)),
    )

    with pytest.raises(expected):
        api.patch.__handler__(
            api,
            _context(database_session, acct_id, ws_id),
            workspace_id=ws_id,
            member_id=member_id,
            body=MemberRoleUpdatePayload(role="admin"),
        )
