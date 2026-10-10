"""Tests for Flask app context module."""

import contextvars

import pytest
from flask import Flask, current_app, g
from flask_sqlalchemy import SQLAlchemy

from models.account import Account


@pytest.fixture
def flask_app() -> Flask:
    app = Flask(__name__)
    app.config.update(TEST_KEY="test_value", TEST="value", SQLALCHEMY_DATABASE_URI="sqlite://")
    SQLAlchemy(app)
    return app


class TestFlaskAppContext:
    """Test FlaskAppContext implementation."""

    def test_flask_app_context_initialization(self, flask_app):
        """Test FlaskAppContext initialization."""
        # Import here to avoid Flask dependency in test environment
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(flask_app)

        assert ctx.flask_app == flask_app

    def test_flask_app_context_get_config(self, flask_app):
        """Test get_config returns Flask app config value."""
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(flask_app)

        assert ctx.get_config("TEST_KEY") == "test_value"

    def test_flask_app_context_get_config_default(self, flask_app):
        """Test get_config returns default when key not found."""
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(flask_app)

        assert ctx.get_config("NONEXISTENT", "default") == "default"

    def test_flask_app_context_get_extension(self, flask_app):
        """Test get_extension returns Flask extension."""
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(flask_app)
        db_ext = flask_app.extensions["sqlalchemy"]

        assert ctx.get_extension("sqlalchemy") == db_ext

    def test_flask_app_context_get_extension_not_found(self, flask_app):
        """Test get_extension returns None when extension not found."""
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(flask_app)

        assert ctx.get_extension("nonexistent") is None

    def test_flask_app_context_enter(self, flask_app):
        """Test enter method enters Flask app context."""
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(flask_app)

        with ctx.enter():
            assert current_app._get_current_object() is flask_app


class TestFlaskExecutionContext:
    """Test FlaskExecutionContext class."""

    def test_initialization(self, flask_app):
        """Test FlaskExecutionContext initialization."""
        from context.flask_app_context import FlaskExecutionContext

        context_vars = contextvars.copy_context()
        user = Account(name="user-123", email="user-123@example.com")

        ctx = FlaskExecutionContext(
            flask_app=flask_app,
            context_vars=context_vars,
            user=user,
        )

        assert ctx.context_vars == context_vars
        assert ctx.user == user

    def test_app_context_property(self, flask_app):
        """Test app_context property returns FlaskAppContext."""
        from context.flask_app_context import FlaskAppContext, FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=flask_app,
            context_vars=contextvars.copy_context(),
        )

        assert isinstance(ctx.app_context, FlaskAppContext)
        assert ctx.app_context.flask_app == flask_app

    def test_context_manager_protocol(self, flask_app):
        """Test FlaskExecutionContext supports context manager protocol."""
        from context.flask_app_context import FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=flask_app,
            context_vars=contextvars.copy_context(),
        )

        # Should have __enter__ and __exit__ methods
        assert hasattr(ctx, "__enter__")
        assert hasattr(ctx, "__exit__")

        # Should work as context manager
        with ctx:
            pass


class TestCaptureFlaskContext:
    """Test capture_flask_context against real Flask proxies."""

    def test_capture_flask_context_captures_app(self, flask_app):
        from context.flask_app_context import capture_flask_context

        with flask_app.app_context():
            ctx = capture_flask_context()

        assert ctx._flask_app is flask_app

    def test_capture_flask_context_captures_user_from_g(self, flask_app):
        from context.flask_app_context import capture_flask_context

        user = Account(name="user_123", email="user_123@example.com")
        with flask_app.app_context():
            g._login_user = user
            ctx = capture_flask_context()

        assert ctx.user is user

    def test_capture_flask_context_with_explicit_user(self, flask_app):
        from context.flask_app_context import capture_flask_context

        explicit_user = Account(name="user_456", email="user_456@example.com")
        with flask_app.app_context():
            g._login_user = Account(name="other_user", email="other_user@example.com")
            ctx = capture_flask_context(user=explicit_user)

        assert ctx.user is explicit_user

    def test_capture_flask_context_captures_contextvars(self, flask_app):
        from context.flask_app_context import capture_flask_context

        test_var = contextvars.ContextVar("test_var")
        token = test_var.set("test_value")
        try:
            with flask_app.app_context():
                ctx = capture_flask_context()
            assert ctx.context_vars[test_var] == "test_value"
        finally:
            test_var.reset(token)


class TestFlaskExecutionContextIntegration:
    """Integration tests for FlaskExecutionContext."""

    def test_enter_restores_context_vars(self, flask_app):
        """Test that enter restores captured context variables."""
        # Create a context variable and set a value
        test_var = contextvars.ContextVar("integration_test_var")
        test_var.set("original_value")

        # Capture the context
        context_vars = contextvars.copy_context()

        # Change the value
        test_var.set("new_value")

        # Create FlaskExecutionContext and enter it
        from context.flask_app_context import FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=flask_app,
            context_vars=context_vars,
        )

        with ctx:
            # Value should be restored to original
            assert test_var.get() == "original_value"

        # After exiting, variable stays at the value from within the context
        # (this is expected Python contextvars behavior)
        assert test_var.get() == "original_value"

    def test_enter_enters_flask_app_context(self, flask_app):
        """Test that enter enters Flask app context."""
        from context.flask_app_context import FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=flask_app,
            context_vars=contextvars.copy_context(),
        )

        with ctx:
            # Verify app context was entered
            assert current_app._get_current_object() is flask_app

    def test_enter_restores_user_in_g(self, flask_app):
        """The explicit user is restored into the new Flask app context."""
        from context.flask_app_context import FlaskExecutionContext

        user = Account(name="test_user", email="test_user@example.com")
        ctx = FlaskExecutionContext(
            flask_app=flask_app,
            context_vars=contextvars.copy_context(),
            user=user,
        )

        with ctx:
            assert g._login_user is user

        assert ctx.user is user

    def test_enter_method_as_context_manager(self, flask_app):
        """Test enter method returns a proper context manager."""
        from context.flask_app_context import FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=flask_app,
            context_vars=contextvars.copy_context(),
        )

        # enter() should return a generator/context manager
        with ctx.enter():
            assert current_app._get_current_object() is flask_app
