import pytest
from flask import Flask

from app_factory import create_flask_app_with_configs
from controllers.openapi import bp as openapi_bp


@pytest.fixture
def openapi_app():
    # the real factory: flask-restx wire behaviour (404 route suggestions) is app config
    app = create_flask_app_with_configs()
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


@pytest.fixture
def app():
    a = Flask(__name__)
    a.config["TESTING"] = True
    return a
