import pytest
from werkzeug.exceptions import Forbidden

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.steps import ScopeCheck


def _ctx(scopes, required):
    c = Context(required_scope=required)
    c.scopes = frozenset(scopes)
    return c


def test_scope_check_passes_on_full():
    ScopeCheck()(_ctx({"full"}, "apps:run"))


def test_scope_check_passes_on_explicit_match():
    ScopeCheck()(_ctx({"apps:run"}, "apps:run"))


def test_scope_check_rejects_when_missing():
    with pytest.raises(Forbidden) as exc:
        ScopeCheck()(_ctx({"apps:read"}, "apps:run"))
    assert "insufficient_scope" in str(exc.value.description)
