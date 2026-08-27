import pytest
from flask import Flask

from controllers.openapi import bp as openapi_bp


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
