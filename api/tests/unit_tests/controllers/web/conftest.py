"""Shared fixtures for controllers.web unit tests."""

from __future__ import annotations

import pytest
from flask import Flask


@pytest.fixture
def app() -> Flask:
    """Minimal Flask app for request contexts."""
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app
