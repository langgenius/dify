"""Phase E step 17: workspace reads at /openapi/v1/workspaces. Bearer-authed
list + member-gated detail. No legacy /v1/ equivalent — the cookie-authed
/console/api/workspaces is a separate consumer that stays in console.
"""

import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi.workspaces import WorkspaceByIdApi, WorkspacesApi

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def openapi_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


def _rule(app: Flask, path: str):
    return next(r for r in app.url_map.iter_rules() if r.rule == path)


def test_workspaces_list_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/workspaces" in rules


def test_workspaces_list_dispatches_to_workspaces_api(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/workspaces")
    assert openapi_app.view_functions[rule.endpoint].view_class is WorkspacesApi
    assert "GET" in rule.methods


def test_workspace_by_id_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/workspaces/<string:workspace_id>" in rules


def test_workspace_by_id_dispatches_to_correct_class(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/workspaces/<string:workspace_id>")
    assert openapi_app.view_functions[rule.endpoint].view_class is WorkspaceByIdApi
    assert "GET" in rule.methods


def test_console_legacy_workspaces_route_not_remounted_on_openapi(openapi_app: Flask):
    """Phase E only adds the bearer-authed mounts on /openapi/v1/.
    The cookie-authed /console/api/workspaces stays where it is.
    """
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/console/api/workspaces" not in rules
