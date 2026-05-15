import pytest
from flask import Flask

from controllers.openapi import bp as openapi_bp
from controllers.openapi.auth.pipeline import Pipeline


@pytest.fixture
def bypass_pipeline(monkeypatch):
    """Stub Pipeline.run so endpoint decoration does not invoke real auth.

    Module-level @OAUTH_BEARER_PIPELINE.guard(...) captures the real
    pipeline at import time; mocking the module attribute does not undo
    that. Patching Pipeline.run on the class is the bypass that actually
    works.
    """
    monkeypatch.setattr(Pipeline, "run", lambda self, ctx: None)


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
