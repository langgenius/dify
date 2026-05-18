"""Role-gate tests.

The decorator wraps `validate_bearer` + `accept_subjects` and must:
- 404 when caller is not a member of ``workspace_id`` (parity with
  `GET /openapi/v1/workspaces/<id>`; prevents tenant-id existence leak)
- 403 when caller IS a member but their role is not in the allowed set
- pass through when role matches (or when no role restriction given)
- raise RuntimeError on missing g.auth_ctx / account_id / workspace_id —
  those are wiring bugs, not user-driven failures
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, g
from werkzeug.exceptions import Forbidden, NotFound

from controllers.openapi.auth.role_gate import require_workspace_role
from libs.oauth_bearer import AuthContext, Scope, SubjectType
from models.account import TenantAccountRole


def _account_ctx(account_id: uuid.UUID | None = None) -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="user@example.com",
        subject_issuer="dify:account",
        account_id=account_id or uuid.uuid4(),
        client_id="difyctl",
        scopes=frozenset({Scope.FULL}),
        token_id=uuid.uuid4(),
        source="oauth_account",
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
        source="oauth_external_sso",
        expires_at=datetime.now(UTC),
        token_hash="h2",
        verified_tenants={},
    )


def _join(role: TenantAccountRole) -> SimpleNamespace:
    return SimpleNamespace(role=role)


def _scalar(value: object) -> MagicMock:
    """Build a MagicMock that mimics `db.session.execute(...).scalar_one_or_none()`."""

    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


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
        g.auth_ctx = _account_ctx()
        with patch("controllers.openapi.auth.role_gate.db") as mock_db:
            mock_db.session.execute.return_value = _scalar(None)
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
        g.auth_ctx = _account_ctx()
        with patch("controllers.openapi.auth.role_gate.db") as mock_db:
            mock_db.session.execute.return_value = _scalar(_join(TenantAccountRole.NORMAL))
            with pytest.raises(Forbidden):
                view(workspace_id=workspace_id)


def test_editor_blocked_when_admin_required():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role(TenantAccountRole.OWNER, TenantAccountRole.ADMIN)
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/members"):
        g.auth_ctx = _account_ctx()
        with patch("controllers.openapi.auth.role_gate.db") as mock_db:
            mock_db.session.execute.return_value = _scalar(_join(TenantAccountRole.EDITOR))
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
        g.auth_ctx = _account_ctx()
        with patch("controllers.openapi.auth.role_gate.db") as mock_db:
            mock_db.session.execute.return_value = _scalar(_join(TenantAccountRole.ADMIN))
            assert view(workspace_id=workspace_id) == "ok"


def test_owner_passes_when_admin_required():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role(TenantAccountRole.OWNER, TenantAccountRole.ADMIN)
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/members"):
        g.auth_ctx = _account_ctx()
        with patch("controllers.openapi.auth.role_gate.db") as mock_db:
            mock_db.session.execute.return_value = _scalar(_join(TenantAccountRole.OWNER))
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
            g.auth_ctx = _account_ctx()
            with patch("controllers.openapi.auth.role_gate.db") as mock_db:
                mock_db.session.execute.return_value = _scalar(_join(role))
                assert view(workspace_id=workspace_id) == "ok"


def test_membership_only_still_404s_non_member():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role()
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/switch"):
        g.auth_ctx = _account_ctx()
        with patch("controllers.openapi.auth.role_gate.db") as mock_db:
            mock_db.session.execute.return_value = _scalar(None)
            with pytest.raises(NotFound):
                view(workspace_id=workspace_id)


# ---------------------------------------------------------------------------
# Query is scoped to the caller's account_id and the URL workspace_id
# ---------------------------------------------------------------------------


def test_query_is_scoped_to_caller_and_workspace():
    """The decorator must look up `(workspace_id, caller's account_id)` —
    otherwise a member of workspace A could quietly hit endpoints for
    workspace B. Inspect the SQLAlchemy expressions we end up handing to
    `db.session.execute` to make that guarantee load-bearing.
    """

    app = Flask(__name__)
    account_id = uuid.uuid4()
    workspace_id = str(uuid.uuid4())

    @require_workspace_role()
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/switch"):
        g.auth_ctx = _account_ctx(account_id=account_id)
        with patch("controllers.openapi.auth.role_gate.db") as mock_db:
            mock_db.session.execute.return_value = _scalar(_join(TenantAccountRole.NORMAL))
            view(workspace_id=workspace_id)

        stmt = mock_db.session.execute.call_args.args[0]
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert workspace_id in compiled
        assert str(account_id) in compiled


# ---------------------------------------------------------------------------
# Wiring bugs surface as RuntimeError (loud), not 403 (silent)
# ---------------------------------------------------------------------------


def test_missing_g_auth_ctx_is_runtime_error():
    app = Flask(__name__)
    workspace_id = str(uuid.uuid4())

    @require_workspace_role()
    def view(workspace_id: str) -> str:
        return "ok"

    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/switch"):
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
        g.auth_ctx = _sso_ctx()
        with pytest.raises(RuntimeError):
            view(workspace_id=workspace_id)


def test_missing_workspace_id_kwarg_is_runtime_error():
    app = Flask(__name__)

    @require_workspace_role()
    def view() -> str:
        return "ok"

    with app.test_request_context("/openapi/v1/foo"):
        g.auth_ctx = _account_ctx()
        with pytest.raises(RuntimeError):
            view()
