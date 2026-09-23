"""Member endpoints under /openapi/v1/workspaces/<id>/...

Coverage:
- Payload validation lands at 422 on the wire (unified via @accepts) — one
  table for every `@accepts` route with a body or query model, the human-input
  submit route included, since all of them share `admitted_bearer`
- Domain exception → HTTP code mapping is preserved with the service's
  original message (so CLI users see what the console user sees)
- Response shape matches the Pydantic models
- Invitations persist through the application service and its repositories

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
from http import HTTPMethod
from unittest.mock import Mock

import pytest
from flask import Flask
from flask.views import MethodView
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound
from werkzeug.test import TestResponse

from constants.oauth_bearer import TokenType
from controllers.openapi import bp as openapi_bp
from controllers.openapi import workspaces as workspaces_module
from controllers.openapi._errors import (
    ErrorBody,
    OpenApiErrorCode,
)
from controllers.openapi._models import MemberInvitePayload, MemberListQuery, MemberRoleUpdatePayload
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_caller, load_workspace
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.workspaces import WorkspaceMemberApi, WorkspaceMembersApi, WorkspaceSwitchApi
from libs.oauth_bearer import AuthContext
from models import Account, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from services.account_errors import AccountNotFoundError, AccountRegisterError
from services.errors.base import NoPermissionError
from services.errors.workspace import (
    AccountAlreadyInTenantError,
    CannotOperateSelfError,
    InvalidWorkspaceMemberRoleError,
    MemberNotInTenantError,
    RoleAlreadyAssignedError,
    WorkspaceInvitationQuotaError,
    WorkspaceMemberLicenseQuotaError,
    WorkspaceNotLinkedError,
)
from tests.unit_tests.account_domain import AccountDomain
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld
from tests.unit_tests.model_factories import make_account, make_tenant

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
    return make_account(account_id=account_id, name="User", email=email)


def _tenant(tenant_id: str = "ws-1") -> Tenant:
    tenant = make_tenant(tenant_id=tenant_id, name="WS")
    tenant.created_at = datetime(2026, 5, 18)
    return tenant


def _persist_workspace(
    session: Session,
    workspace_id: str,
    memberships: list[tuple[str, str, TenantAccountRole, bool]],
) -> tuple[Tenant, list[Account]]:
    tenant = _tenant(workspace_id)
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


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (MemberInvitePayload, {"email": "not-an-email", "role": TenantAccountRole.NORMAL}),
        (MemberInvitePayload, {"email": "u@example.com", "role": TenantAccountRole.NORMAL, "extra": "x"}),
        (MemberRoleUpdatePayload, {"role": TenantAccountRole.NORMAL, "extra": "x"}),
    ],
    ids=["invite.bad_email", "invite.extra_field", "role.extra_field"],
)
def test_payload_models_reject(model: type[BaseModel], payload: dict[str, object]):
    with pytest.raises(ValidationError):
        model.model_validate(payload)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        (
            HTTPMethod.POST,
            "/openapi/v1/workspaces/{workspace_id}/members",
            {"email": "u@example.com", "role": TenantAccountRole.OWNER},
        ),
        (
            HTTPMethod.PATCH,
            "/openapi/v1/workspaces/{workspace_id}/members/{member_id}",
            {"role": TenantAccountRole.OWNER},
        ),
        (HTTPMethod.GET, "/openapi/v1/workspaces/{workspace_id}/members?pg=2", None),
        (
            HTTPMethod.POST,
            "/openapi/v1/apps/{app_id}/human-input-forms/tok-1:submit",
            {"inputs": {"field1": "val"}},
        ),
    ],
    ids=["invite.owner", "update_role.owner", "members_list.unknown_query", "human_input_form.missing_action"],
)
def test_invalid_request_is_422_on_the_wire(
    admitted_bearer: AdmittedWorld, method: HTTPMethod, path: str, body: dict[str, object] | None
):
    """Owner is not assignable, query models are `extra='forbid'`, and the form
    submit needs an action: each surfaces as 422 from `@accepts` inside the guard.
    """
    resp = admitted_bearer.client.open(
        path.format(
            workspace_id=admitted_bearer.workspace_id,
            member_id=admitted_bearer.member_id,
            app_id=admitted_bearer.app_id,
        ),
        method=method,
        json=body,
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
        workspaces_module.application_services().workspaces.management,
        "switch_membership",
        Mock(side_effect=WorkspaceNotLinkedError("…")),
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


def test_members_list_next_page_hint_reaches_the_wire(admitted_bearer: AdmittedWorld, database_session: Session):
    for i in range(4):
        member_id = str(uuid.uuid4())
        database_session.add_all(
            [
                _account(account_id=member_id, email=f"member{i}@example.com"),
                TenantAccountJoin(
                    tenant_id=admitted_bearer.workspace_id,
                    account_id=member_id,
                    current=False,
                    role=TenantAccountRole.NORMAL,
                ),
            ]
        )
    database_session.commit()

    res = admitted_bearer.client.get(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/members?page=1&limit=2",
        headers=admitted_bearer.headers,
    )

    assert res.status_code == 200
    body = res.get_json()
    assert body["has_more"] is True
    assert body["hints"] == [
        {
            "summary": "Next page",
            "op": "workspace.members.list",
            "input": {"workspace_id": admitted_bearer.workspace_id, "page": 2, "limit": 2},
            "form": None,
        }
    ]


# ---------------------------------------------------------------------------
# Invite endpoint
# ---------------------------------------------------------------------------


def _invite_body(email: str = "new@example.com") -> MemberInvitePayload:
    return MemberInvitePayload(email=email, role="normal")


def test_invite_happy_path_returns_invite_url_and_member_id(
    database_session: Session, account_domain: AccountDomain
) -> None:
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
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
    invited = account_domain.repository.get(result.member_id)
    assert invited is not None
    assert invited.email == result.email
    assert "token=invitation-token" in result.invite_url
    assert "email=new%40example.com" in result.invite_url
    assert result.tenant_id == ws_id


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (WorkspaceInvitationQuotaError(), OpenApiErrorCode.MEMBER_LIMIT_EXCEEDED),
        (WorkspaceMemberLicenseQuotaError(), OpenApiErrorCode.MEMBER_LICENSE_EXCEEDED),
    ],
)
def test_invitation_quota_admission_preserves_error_contract(
    admitted_bearer: AdmittedWorld,
    account_domain: AccountDomain,
    error: WorkspaceInvitationQuotaError,
    code: OpenApiErrorCode,
) -> None:
    account_domain.delivery.check_invitation_quota.side_effect = error

    response = admitted_bearer.client.post(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/members",
        headers=admitted_bearer.headers,
        json={"email": "new@example.com", "role": "normal"},
    )

    assert response.status_code == 403
    assert ErrorBody.model_validate(response.get_json()).code == code
    account_domain.delivery.check_invitation_quota.assert_called_once_with(admitted_bearer.workspace_id)
    assert account_domain.repository.find_by_email("new@example.com") is None
    account_domain.delivery.send.assert_not_called()


def test_invitation_permission_rejection_precedes_quota_lookup(
    admitted_bearer: AdmittedWorld, account_domain: AccountDomain, sqlite_session: Session
) -> None:
    membership = sqlite_session.scalar(
        select(TenantAccountJoin).where(TenantAccountJoin.tenant_id == admitted_bearer.workspace_id)
    )
    assert membership is not None
    membership.role = TenantAccountRole.NORMAL
    sqlite_session.commit()

    response = admitted_bearer.client.post(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/members",
        headers=admitted_bearer.headers,
        json={"email": "new@example.com", "role": "normal"},
    )

    assert response.status_code == 403
    assert ErrorBody.model_validate(response.get_json()).code == OpenApiErrorCode.FORBIDDEN
    account_domain.delivery.check_invitation_quota.assert_not_called()
    account_domain.delivery.send.assert_not_called()


@pytest.mark.parametrize(
    "exc",
    [
        AccountAlreadyInTenantError("already in tenant"),
        AccountRegisterError("Workspace is not allowed to create."),
        InvalidWorkspaceMemberRoleError("Dataset operators are not enabled."),
    ],
    ids=["already_in_tenant", "register_error", "invalid_role"],
)
def test_invite_400_on_registration_refusal(monkeypatch: pytest.MonkeyPatch, database_session: Session, exc: Exception):
    ws_id = str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMembersApi()

    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
    )

    monkeypatch.setattr(
        workspaces_module.application_services().workspaces.invitations, "invite", Mock(side_effect=exc)
    )

    with pytest.raises(BadRequest):
        api.post.__handler__(
            api,
            _context(database_session, acct_id, ws_id),
            workspace_id=ws_id,
            body=_invite_body(),
        )


# ---------------------------------------------------------------------------
# Delete member
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("member_id_format", ["canonical", "uppercase", "hex"])
def test_delete_member_happy_path(
    database_session: Session, account_domain: AccountDomain, member_id_format: str
) -> None:
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

    path_member_id = _member_id_variant(member_id, member_id_format)
    result = api.delete.__handler__(
        api, _context(database_session, acct_id, ws_id), workspace_id=ws_id, member_id=path_member_id
    )

    assert result.result == "success"
    assert account_domain.members.get_role(ws_id, member_id) is None
    assert account_domain.repository.get(member_id) is not None


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (CannotOperateSelfError("cannot operate self"), BadRequest),
        (NoPermissionError("no permission"), BadRequest),
        (MemberNotInTenantError("not in tenant"), NotFound),
        (AccountNotFoundError(), NotFound),
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

    monkeypatch.setattr(workspaces_module.application_services().workspaces.members, "remove", Mock(side_effect=exc))

    with pytest.raises(expected):
        api.delete.__handler__(api, _context(database_session, acct_id, ws_id), workspace_id=ws_id, member_id=member_id)


@pytest.mark.parametrize("method", ["delete", "patch"])
def test_member_mutation_404_when_account_missing(database_session: Session, method: str) -> None:
    ws_id, member_id = str(uuid.uuid4()), str(uuid.uuid4())
    acct_id = uuid.uuid4()
    api = WorkspaceMemberApi()

    _persist_workspace(
        database_session,
        ws_id,
        [(str(acct_id), "caller@example.com", TenantAccountRole.OWNER, True)],
    )

    ctx = _context(database_session, acct_id, ws_id)
    if method == "delete":
        with pytest.raises(NotFound, match="member not found"):
            api.delete.__handler__(api, ctx, workspace_id=ws_id, member_id=member_id)
    else:
        with pytest.raises(NotFound, match="member not found"):
            api.patch.__handler__(
                api,
                ctx,
                workspace_id=ws_id,
                member_id=member_id,
                body=MemberRoleUpdatePayload(role="admin"),
            )


# ---------------------------------------------------------------------------
# Update role
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("member_id_format", ["canonical", "uppercase", "hex"])
def test_update_role_happy_path(
    database_session: Session, account_domain: AccountDomain, member_id_format: str
) -> None:
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

    result = api.patch.__handler__(
        api,
        _context(database_session, acct_id, ws_id),
        workspace_id=ws_id,
        member_id=_member_id_variant(member_id, member_id_format),
        body=MemberRoleUpdatePayload(role="admin"),
    )

    assert result.result == "success"
    assert account_domain.members.get_role(ws_id, member_id) == TenantAccountRole.ADMIN


def _member_id_variant(member_id: str, variant: str) -> str:
    if variant == "uppercase":
        return member_id.upper()
    if variant == "hex":
        return uuid.UUID(member_id).hex
    if variant == "uppercase_hex":
        return uuid.UUID(member_id).hex.upper()
    return member_id


@pytest.mark.parametrize("member_id_format", ["canonical", "uppercase", "hex", "uppercase_hex"])
@pytest.mark.parametrize(
    ("method", "caller_role"), [("DELETE", TenantAccountRole.OWNER), ("PATCH", TenantAccountRole.ADMIN)]
)
def test_member_id_aliases_cannot_bypass_self_operation_guard(
    admitted_bearer: AdmittedWorld,
    database_session: Session,
    account_domain: AccountDomain,
    member_id_format: str,
    method: str,
    caller_role: TenantAccountRole,
) -> None:
    membership = database_session.scalar(
        select(TenantAccountJoin).where(TenantAccountJoin.tenant_id == admitted_bearer.workspace_id)
    )
    assert membership is not None
    account_id = membership.account_id
    membership.role = caller_role
    owner_id = account_id
    if caller_role == TenantAccountRole.ADMIN:
        owner_id = str(uuid.uuid4())
        database_session.add_all(
            [
                _account(owner_id, "owner@example.com"),
                TenantAccountJoin(
                    tenant_id=admitted_bearer.workspace_id, account_id=owner_id, role=TenantAccountRole.OWNER
                ),
            ]
        )
    database_session.commit()
    path_member_id = _member_id_variant(account_id, member_id_format)

    response = admitted_bearer.client.open(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/members/{path_member_id}",
        method=method,
        headers=admitted_bearer.headers,
        json={"role": "normal"} if method == "PATCH" else None,
    )

    assert response.status_code == 400
    error = ErrorBody.model_validate(response.get_json())
    assert error.code == OpenApiErrorCode.BAD_REQUEST
    assert error.message == "Cannot operate self."
    assert account_domain.members.get_role(admitted_bearer.workspace_id, account_id) == caller_role
    assert account_domain.members.get_role(admitted_bearer.workspace_id, owner_id) == TenantAccountRole.OWNER
    account_domain.access.member_removed.assert_not_called()
    account_domain.access.change_role.assert_not_called()


@pytest.mark.parametrize("method", ["DELETE", "PATCH"])
def test_malformed_member_id_returns_404(admitted_bearer: AdmittedWorld, method: str) -> None:
    response = admitted_bearer.client.open(
        f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/members/not-a-uuid",
        method=method,
        headers=admitted_bearer.headers,
        json={"role": "admin"} if method == "PATCH" else None,
    )

    assert response.status_code == 404
    assert ErrorBody.model_validate(response.get_json()).message == "member not found"


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (CannotOperateSelfError("cannot operate self"), BadRequest),
        (NoPermissionError("no permission"), BadRequest),
        (RoleAlreadyAssignedError("already"), BadRequest),
        (InvalidWorkspaceMemberRoleError("Dataset operators are not enabled."), BadRequest),
        (MemberNotInTenantError("not in tenant"), NotFound),
        (AccountNotFoundError(), NotFound),
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
        workspaces_module.application_services().workspaces.members, "update_role", Mock(side_effect=exc)
    )

    with pytest.raises(expected):
        api.patch.__handler__(
            api,
            _context(database_session, acct_id, ws_id),
            workspace_id=ws_id,
            member_id=member_id,
            body=MemberRoleUpdatePayload(role="admin"),
        )
