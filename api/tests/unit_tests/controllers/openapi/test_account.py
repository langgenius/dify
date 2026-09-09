"""User-scoped identity + session endpoints under /openapi/v1/account."""

import builtins
import sys
import uuid
from types import SimpleNamespace

import pytest
from flask import Flask
from flask.views import MethodView
from pydantic import ValidationError
from werkzeug.exceptions import NotFound

from controllers.openapi._models import SessionListQuery
from controllers.openapi.account import AccountSessionByIdApi, AccountSessionsApi
from machinery.context import AccountRequestContext
from services.account_errors import AccountSessionNotFoundError
from services.entities.account_access_entities import AccountSessionPage

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.mark.parametrize("session_id", [str(uuid.uuid4()), "not-a-uuid"], ids=["foreign", "malformed"])
def test_revoke_by_id_hides_a_session_the_caller_does_not_own(
    app: Flask, monkeypatch: pytest.MonkeyPatch, session_id: str
) -> None:
    """The access service refuses a token id owned by another account, and a
    malformed id never reaches it; the route answers 404 either way, not 403,
    so session ids cannot be probed across accounts.
    """
    api = AccountSessionByIdApi()
    _stub_account_service(monkeypatch)
    with app.test_request_context(f"/openapi/v1/account/sessions/{session_id}", method="DELETE"):
        with pytest.raises(NotFound, match="session not found"):
            api.delete.__handler__(api, _ctx(), session_id=session_id)


# --- GET /account/sessions query validation. The application service is replaced
# with a small fake so these exercise only the handler's projection; `__handler__`
# receives an already-validated query, so the bounds are pinned at the model. ---

_ACCOUNT_MOD = "controllers.openapi.account"


def _ctx() -> SimpleNamespace:
    return SimpleNamespace(subject=SimpleNamespace(account_id=uuid.uuid4(), token_id=uuid.uuid4()))


class _SessionListService:
    def list_sessions(self, _context: AccountRequestContext, *, page: int, limit: int) -> AccountSessionPage:
        return AccountSessionPage(page=page, limit=limit, total=0, items=())

    def revoke_session(self, _context: AccountRequestContext, *, token_id: str) -> None:
        raise AccountSessionNotFoundError(token_id)


def _stub_account_service(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = sys.modules[_ACCOUNT_MOD]
    services = SimpleNamespace(accounts=SimpleNamespace(access=_SessionListService()))
    monkeypatch.setattr(mod, "application_services", lambda: services)


def test_sessions_list_valid_query_parses_page_and_limit(app: Flask, monkeypatch: pytest.MonkeyPatch):
    """A valid page/limit round-trips through SessionListQuery into the response envelope."""
    api = AccountSessionsApi()
    _stub_account_service(monkeypatch)
    with app.test_request_context("/openapi/v1/account/sessions?page=2&limit=5"):
        result = api.get.__handler__(api, _ctx(), query=SessionListQuery(page=2, limit=5))
    assert result.page == 2
    assert result.limit == 5
    assert result.total == 0
    assert result.data == []


@pytest.mark.parametrize(
    "params",
    [
        {"page": "0"},
        {"limit": "0"},
        {"limit": "999"},
        {"foo": "bar"},
    ],
)
def test_session_list_query_rejects_out_of_bounds(params):
    with pytest.raises(ValidationError):
        SessionListQuery.model_validate(params)
