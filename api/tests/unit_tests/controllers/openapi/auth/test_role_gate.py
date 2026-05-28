"""Role-gate tests.

The decorator wraps `validate_bearer` + `accept_subjects` and must:
- 404 when caller is not a member of ``workspace_id`` (parity with
  `GET /openapi/v1/workspaces/<id>`; prevents tenant-id existence leak)
- 403 when caller IS a member but their role is not in the allowed set
- pass through when role matches (or when no role restriction given)
- raise RuntimeError on missing auth context / account_id / workspace_id —
  those are wiring bugs, not user-driven failures

Identity is read from the openapi auth ContextVar — the slot
`validate_bearer` publishes — so these tests seed it via `_seed`
(``set_auth_ctx``), NOT ``flask.g``. `test_seeding_only_flask_g_*`
locks in that ``g`` is *not* a valid identity source.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound

from controllers.openapi.auth.role_gate import require_workspace_role
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType, reset_auth_ctx, set_auth_ctx
from models.account import TenantAccountRole

# Tokens from `_seed`'s `set_auth_ctx` calls, drained after each test so a
# published identity can't leak into the next (the ContextVar is module-global
# and worker threads are reused). Seed via `_seed(...)`, never `flask.g`.
_seed_tokens: list = []


def _seed(ctx: AuthContext) -> None:
    _seed_tokens.append(set_auth_ctx(ctx))


@pytest.fixture(autouse=True)
def _reset_auth_ctx():
    yield
    while _seed_tokens:
        reset_auth_ctx(_seed_tokens.pop())


def _account_ctx(account_id: uuid.UUID | None = None) -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="user@example.com",
        subject_issuer="dify:account",
        account_id=account_id or uuid.uuid4(),
        client_id="difyctl",
        scopes=frozenset({Scope.FULL}),
        token_id=uuid.uuid4(),
        token_type=TokenType.OAUTH_ACCOUNT,
        expires_at=datetime.now(UTC),
        token_hash="h1",
        verified_tenants={},
    )


def _sso_ctx() -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.EXTERNAL_SSO,
        subject_email="sso@partner.com",
        subject_issuer="https://idp.partner.com",
        account_id=None,
        client_id="difyctl",
        scopes=frozenset({Scope.APPS_RUN}),
        token_id=uuid.uuid4(),
        token_type=TokenType.OAUTH_EXTERNAL_SSO,
        expires_at=datetime.now(UTC),
        token_hash="h2",
        verified_tenants={},
    )


@contextmanager
def _stub_role(role: TenantAccountRole | None):
    """Stub the service-layer membership lookup the gate delegates to.

    The gate no longer issues SQL itself — it calls
    ``TenantService.get_account_role_in_tenant`` and acts purely on the
    returned role (``None`` → non-member). These tests pin that behaviour;
    the query itself is covered in ``TestTenantService``.
    """
    with patch(
        "controllers.openapi.auth.role_gate.TenantService.get_account_role_in_tenant",
        return_value=role,
    ) as mocked:
        yield mocked


# ---------------------------------------------------------------------------
# Non-member → 404
# ---------------------------------------------------------------------------


def test_non_member_gets_404():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role()
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/switch"):
        _seed(_account_ctx())
        with _stub_role(None):
            with pytest.raises(NotFound):
                view(workspace_id=workspace_id)


# ---------------------------------------------------------------------------
# Member with insufficient role → 403
# ---------------------------------------------------------------------------


def test_normal_member_blocked_when_admin_required():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role(TenantAccountRole.OWNER, TenantAccountRole.ADMIN)
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/members"):
        _seed(_account_ctx())
        with _stub_role(TenantAccountRole.NORMAL):
            with pytest.raises(Forbidden):
                view(workspace_id=workspace_id)


def test_editor_blocked_when_admin_required():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role(TenantAccountRole.OWNER, TenantAccountRole.ADMIN)
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/members"):
        _seed(_account_ctx())
        with _stub_role(TenantAccountRole.EDITOR):
            with pytest.raises(Forbidden):
                view(workspace_id=workspace_id)


# ---------------------------------------------------------------------------
# Member with allowed role → pass
# ---------------------------------------------------------------------------


def test_admin_passes_when_admin_required():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role(TenantAccountRole.OWNER, TenantAccountRole.ADMIN)
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/members"):
        _seed(_account_ctx())
        with _stub_role(TenantAccountRole.ADMIN):
            assert view(workspace_id=workspace_id) == "ok"


def test_owner_passes_when_admin_required():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role(TenantAccountRole.OWNER, TenantAccountRole.ADMIN)
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/members"):
        _seed(_account_ctx())
        with _stub_role(TenantAccountRole.OWNER):
            assert view(workspace_id=workspace_id) == "ok"


# ---------------------------------------------------------------------------
# Membership-only (no role restriction)
# ---------------------------------------------------------------------------


def test_membership_only_passes_for_any_role():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role()
    def view(workspace_id: str) -> str:
        return "ok"

    for role in (
        TenantAccountRole.OWNER,
        TenantAccountRole.ADMIN,
        TenantAccountRole.EDITOR,
        TenantAccountRole.NORMAL,
        TenantAccountRole.DATASET_OPERATOR,
    ):
        with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/switch"):
            _seed(_account_ctx())
            with _stub_role(role):
                assert view(workspace_id=workspace_id) == "ok"


def test_membership_only_still_404s_non_member():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role()
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/switch"):
        _seed(_account_ctx())
        with _stub_role(None):
            with pytest.raises(NotFound):
                view(workspace_id=workspace_id)


# ---------------------------------------------------------------------------
# Lookup is scoped to the caller's account_id and the URL workspace_id
# ---------------------------------------------------------------------------


def test_lookup_is_scoped_to_caller_and_workspace():
    """The decorator must delegate the lookup keyed on
    `(caller's account_id, URL workspace_id)` — otherwise a member of
    workspace A could quietly hit endpoints for workspace B. Assert the
    exact arguments handed to the service; the SQL those arguments compile
    to is pinned in ``TestTenantService.test_get_account_role_in_tenant_*``.
    """

    app = Flask(__name__)
    account_id = uuid.uuid4()
    workspace_id = str(uuid.uuid4())

    @require_workspace_role()
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/switch"):
        _seed(_account_ctx(account_id=account_id))
        with _stub_role(TenantAccountRole.NORMAL) as mocked:
            view(workspace_id=workspace_id)

        _session, passed_account_id, passed_workspace_id = mocked.call_args.args
        assert passed_account_id == str(account_id)
        assert passed_workspace_id == workspace_id


# ---------------------------------------------------------------------------
# Wiring bugs surface as RuntimeError (loud), not 403 (silent)
# ---------------------------------------------------------------------------


def test_missing_auth_ctx_is_runtime_error():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role()
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/switch"):
        with pytest.raises(RuntimeError):
            view(workspace_id=workspace_id)


def test_seeding_only_flask_g_does_not_satisfy_gate():
    """Regression — pins the identity source to the ContextVar, not ``flask.g``.

    Production fills the ContextVar (``validate_bearer`` → ``set_auth_ctx``)
    and never touches ``g.auth_ctx``. An earlier revision of this gate read
    ``g.auth_ctx``, so every real request raised RuntimeError → 500 while the
    suite stayed green (it seeded ``g`` directly). Here we seed ONLY ``g`` and
    leave the ContextVar empty: the gate must still raise, proving it does not
    accept ``g`` as an identity source. Reading ``g`` again would let the
    membership lookup run (stubbed to succeed) and this would fail.
    """
    from flask import g

    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role()
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/switch"):
        g.auth_ctx = _account_ctx()  # the wrong slot — must be ignored
        with _stub_role(TenantAccountRole.OWNER):
            with pytest.raises(RuntimeError):
                view(workspace_id=workspace_id)


def test_sso_caller_is_runtime_error():
    """External SSO context has account_id=None — the caller stacked the
    role gate without `accept_subjects(SubjectType.ACCOUNT)`. That's a
    wiring bug, surface it as RuntimeError rather than 404 the SSO user."""

    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role()
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/switch"):
        _seed(_sso_ctx())
        with pytest.raises(RuntimeError):
            view(workspace_id=workspace_id)


def test_missing_workspace_id_kwarg_is_runtime_error():
    app = Flask(__name__)

    @require_workspace_role()
    def view() -> str:
        return "ok"

    with app.test_request_context("/openapi/v1/foo"):
        _seed(_account_ctx())
        with pytest.raises(RuntimeError):
            view()
