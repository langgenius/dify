from types import SimpleNamespace
from unittest.mock import patch

import pytest
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.steps import AppResolver
from models import TenantStatus


def _ctx(path_params: dict[str, str] | None) -> Context:
    return Context(required_scope="apps:run", path_params=path_params or {})


def _app(*, status="normal", enable_api=True):
    return SimpleNamespace(id="app1", tenant_id="t1", status=status, enable_api=enable_api)


def _tenant(*, status=TenantStatus.NORMAL):
    return SimpleNamespace(id="t1", status=status)


def test_resolver_rejects_missing_path_param():
    with pytest.raises(BadRequest):
        AppResolver()(_ctx({}))


def test_resolver_rejects_empty_path_params():
    # `Pipeline.guard` always seeds an empty dict when Flask reports no
    # view args, so a missing `app_id` key surfaces here as BadRequest.
    with pytest.raises(BadRequest):
        AppResolver()(_ctx(None))


@patch("controllers.openapi.auth.steps.db")
def test_resolver_404_when_app_missing(db):
    db.session.get.side_effect = [None]
    with pytest.raises(NotFound):
        AppResolver()(_ctx({"app_id": "x"}))


@patch("controllers.openapi.auth.steps.db")
def test_resolver_403_when_disabled(db):
    db.session.get.side_effect = [_app(enable_api=False)]
    with pytest.raises(Forbidden) as exc:
        AppResolver()(_ctx({"app_id": "x"}))
    assert "service_api_disabled" in str(exc.value.description)


@patch("controllers.openapi.auth.steps.db")
def test_resolver_403_when_tenant_archived(db):
    db.session.get.side_effect = [_app(), _tenant(status=TenantStatus.ARCHIVE)]
    with pytest.raises(Forbidden):
        AppResolver()(_ctx({"app_id": "x"}))


@patch("controllers.openapi.auth.steps.db")
def test_resolver_populates_app_and_tenant(db):
    db.session.get.side_effect = [_app(), _tenant()]
    ctx = _ctx({"app_id": "x"})
    AppResolver()(ctx)
    assert ctx.app.id == "app1"
    assert ctx.tenant.id == "t1"
