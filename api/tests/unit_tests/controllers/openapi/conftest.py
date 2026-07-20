import uuid

import pytest
from flask import Flask

from controllers.openapi import bp as openapi_bp
from controllers.openapi.auth.data import AuthData
from controllers.openapi.auth.pipeline import PipelineRouter
from libs.oauth_bearer import Scope, TokenType


def _stub_execute(
    self,
    args,
    kwargs,
    view,
    *,
    scope=None,
    allowed_token_types=None,
    edition=None,
    workspace_membership=False,
    allowed_roles=None,
    rbac=None,
):
    """Bypass all auth logic; inject minimal AuthData and call the view directly."""
    kwargs["auth_data"] = AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        account_id=uuid.uuid4(),
        token_hash="test",
        token_id=uuid.uuid4(),
        scopes=frozenset({Scope.FULL}),
        required_scope=scope,
        allowed_roles=allowed_roles,
        rbac=rbac,
    )
    return view(*args, **kwargs)


@pytest.fixture
def bypass_pipeline(monkeypatch: pytest.MonkeyPatch):
    """Stub PipelineRouter._execute so endpoints skip real auth at request time.

    Module-level @auth_router.guard(...) captures the real router at import
    time — patching guard itself does nothing. Patching _execute on the class
    is the seam that fires at request time.
    """
    monkeypatch.setattr(PipelineRouter, "_execute", _stub_execute)


@pytest.fixture
def openapi_app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


@pytest.fixture
def app():
    a = Flask(__name__)
    a.config["TESTING"] = True
    return a
