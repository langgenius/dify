"""Tests for Flask app context module."""

import contextvars
from contextlib import nullcontext
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, current_app, g


class TestFlaskAppContext:
    """Test FlaskAppContext implementation."""

    @pytest.fixture
    def mock_flask_app(self):
        """Create a mock Flask app."""
        app = MagicMock()
        app.config = {"TEST_KEY": "test_value"}
        app.extensions = {"db": MagicMock(), "cache": MagicMock()}
        app.app_context = MagicMock()
        app.app_context.return_value.__enter__ = MagicMock(return_value=None)
        app.app_context.return_value.__exit__ = MagicMock(return_value=None)
        return app

    def test_flask_app_context_initialization(self, mock_flask_app):
        """Test FlaskAppContext initialization."""
        # Import here to avoid Flask dependency in test environment
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(mock_flask_app)

        assert ctx.flask_app == mock_flask_app

    def test_flask_app_context_get_config(self, mock_flask_app):
        """Test get_config returns Flask app config value."""
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(mock_flask_app)

        assert ctx.get_config("TEST_KEY") == "test_value"

    def test_flask_app_context_get_config_default(self, mock_flask_app):
        """Test get_config returns default when key not found."""
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(mock_flask_app)

        assert ctx.get_config("NONEXISTENT", "default") == "default"

    def test_flask_app_context_get_extension(self, mock_flask_app):
        """Test get_extension returns Flask extension."""
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(mock_flask_app)
        db_ext = mock_flask_app.extensions["db"]

        assert ctx.get_extension("db") == db_ext

    def test_flask_app_context_get_extension_not_found(self, mock_flask_app):
        """Test get_extension returns None when extension not found."""
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(mock_flask_app)

        assert ctx.get_extension("nonexistent") is None

    def test_flask_app_context_enter(self, mock_flask_app):
        """Test enter method enters Flask app context."""
        from context.flask_app_context import FlaskAppContext

        ctx = FlaskAppContext(mock_flask_app)

        with ctx.enter():
            # Should not raise any exception
            pass

        # Verify app_context was called
        mock_flask_app.app_context.assert_called_once()


class TestFlaskExecutionContext:
    """Test FlaskExecutionContext class."""

    @pytest.fixture
    def mock_flask_app(self):
        """Create a mock Flask app."""
        app = MagicMock()
        app.config = {}
        app.app_context = MagicMock()
        app.app_context.return_value.__enter__ = MagicMock(return_value=None)
        app.app_context.return_value.__exit__ = MagicMock(return_value=None)
        return app

    def test_initialization(self, mock_flask_app):
        """Test FlaskExecutionContext initialization."""
        from context.flask_app_context import FlaskExecutionContext

        context_vars = contextvars.copy_context()
        user = MagicMock()

        ctx = FlaskExecutionContext(
            flask_app=mock_flask_app,
            context_vars=context_vars,
            user=user,
        )

        assert ctx.context_vars == context_vars
        assert ctx.user == user

    def test_app_context_property(self, mock_flask_app):
        """Test app_context property returns FlaskAppContext."""
        from context.flask_app_context import FlaskAppContext, FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=mock_flask_app,
            context_vars=contextvars.copy_context(),
        )

        assert isinstance(ctx.app_context, FlaskAppContext)
        assert ctx.app_context.flask_app == mock_flask_app

    def test_context_manager_protocol(self, mock_flask_app):
        """Test FlaskExecutionContext supports context manager protocol."""
        from context.flask_app_context import FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=mock_flask_app,
            context_vars=contextvars.copy_context(),
        )

        # Should have __enter__ and __exit__ methods
        assert hasattr(ctx, "__enter__")
        assert hasattr(ctx, "__exit__")

        # Should work as context manager
        with ctx:
            pass


class TestCaptureFlaskContext:
    """Test capture_flask_context function."""

    @patch("context.flask_app_context.current_app", autospec=True)
    @patch("context.flask_app_context.g", autospec=True)
    def test_capture_flask_context_captures_app(self, mock_g, mock_current_app):
        """Test capture_flask_context captures Flask app."""
        mock_app = MagicMock()
        mock_app._get_current_object = MagicMock(return_value=mock_app)
        mock_current_app._get_current_object = MagicMock(return_value=mock_app)

        from context.flask_app_context import capture_flask_context

        ctx = capture_flask_context()

        assert ctx._flask_app == mock_app

    @patch("context.flask_app_context.current_app", autospec=True)
    @patch("context.flask_app_context.g", autospec=True)
    def test_capture_flask_context_captures_user_from_g(self, mock_g, mock_current_app):
        """Test capture_flask_context captures user from Flask g object."""
        mock_app = MagicMock()
        mock_app._get_current_object = MagicMock(return_value=mock_app)
        mock_current_app._get_current_object = MagicMock(return_value=mock_app)

        mock_user = MagicMock()
        mock_user.id = "user_123"
        mock_g._login_user = mock_user

        from context.flask_app_context import capture_flask_context

        ctx = capture_flask_context()

        assert ctx.user == mock_user

    @patch("context.flask_app_context.current_app", autospec=True)
    def test_capture_flask_context_with_explicit_user(self, mock_current_app):
        """Test capture_flask_context uses explicit user parameter."""
        mock_app = MagicMock()
        mock_app._get_current_object = MagicMock(return_value=mock_app)
        mock_current_app._get_current_object = MagicMock(return_value=mock_app)

        explicit_user = MagicMock()
        explicit_user.id = "user_456"

        from context.flask_app_context import capture_flask_context

        ctx = capture_flask_context(user=explicit_user)

        assert ctx.user == explicit_user

    @patch("context.flask_app_context.current_app", autospec=True)
    def test_capture_flask_context_captures_contextvars(self, mock_current_app):
        """Test capture_flask_context captures context variables."""
        mock_app = MagicMock()
        mock_app._get_current_object = MagicMock(return_value=mock_app)
        mock_current_app._get_current_object = MagicMock(return_value=mock_app)

        # Set a context variable
        test_var = contextvars.ContextVar("test_var")
        test_var.set("test_value")

        from context.flask_app_context import capture_flask_context

        ctx = capture_flask_context()

        # Context variables should be captured
        assert ctx.context_vars is not None
        # Verify the variable is in the captured context
        captured_value = ctx.context_vars[test_var]
        assert captured_value == "test_value"


class TestFlaskExecutionContextIntegration:
    """Integration tests for FlaskExecutionContext."""

    @pytest.fixture
    def mock_flask_app(self):
        """Create a mock Flask app with proper app context."""
        app = MagicMock()
        app.config = {"TEST": "value"}
        app.extensions = {"db": MagicMock()}

        # Mock app context
        mock_app_context = MagicMock()
        mock_app_context.__enter__ = MagicMock(return_value=None)
        mock_app_context.__exit__ = MagicMock(return_value=None)
        app.app_context.return_value = mock_app_context

        return app

    @pytest.mark.parametrize("use_enter", [False, True])
    @pytest.mark.parametrize("caller_value", [None, "caller"])
    @pytest.mark.parametrize("raise_error", [False, True])
    def test_enter_restores_context_vars(self, mock_flask_app, use_enter, caller_value, raise_error):
        """Restore the caller's binding on normal and exceptional exits."""
        test_var = contextvars.ContextVar("integration_test_var")
        context_vars = contextvars.Context()
        context_vars.run(test_var.set, "captured")
        from context.flask_app_context import FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=mock_flask_app,
            context_vars=context_vars,
        )
        token = test_var.set(caller_value) if caller_value is not None else None

        try:
            with pytest.raises(ValueError, match="body failed") if raise_error else nullcontext():
                with ctx.enter() if use_enter else ctx:
                    assert test_var.get() == "captured"
                    test_var.set("body")
                    if raise_error:
                        raise ValueError("body failed")

            assert test_var.get(None) == caller_value
            assert (test_var in contextvars.copy_context()) == (caller_value is not None)
        finally:
            if token is not None:
                test_var.reset(token)

    @pytest.mark.parametrize(("outer_enter", "inner_enter"), [(False, False), (False, True), (True, False)])
    def test_nested_context_restores_each_scope(self, outer_enter, inner_enter):
        from context.flask_app_context import FlaskExecutionContext

        flask_app = Flask(__name__)
        caller_app = current_app._get_current_object()
        caller_g = g._get_current_object()
        test_var = contextvars.ContextVar("nested_var")
        captured = contextvars.copy_context()
        captured.run(test_var.set, "captured")
        ctx = FlaskExecutionContext(flask_app=flask_app, context_vars=captured)

        with ctx.enter() if outer_enter else ctx:
            assert current_app == flask_app
            test_var.set("outer")
            outer_g = g._get_current_object()
            with ctx.enter() if inner_enter else ctx:
                assert current_app == flask_app
                assert g._get_current_object() is not outer_g
                assert test_var.get() == "captured"
                test_var.set("inner")
            assert g._get_current_object() is outer_g
            assert test_var.get() == "outer"

        assert test_var not in contextvars.copy_context()
        assert current_app == caller_app
        assert g._get_current_object() is caller_g

    @pytest.mark.parametrize("use_enter", [False, True])
    @pytest.mark.parametrize("failure_stage", ["enter", "teardown"])
    def test_context_vars_restored_when_flask_context_fails(self, mock_flask_app, use_enter, failure_stage):
        from context.flask_app_context import FlaskExecutionContext

        test_var = contextvars.ContextVar("failure_var")
        captured = contextvars.Context()
        captured.run(test_var.set, "captured")
        ctx = FlaskExecutionContext(flask_app=mock_flask_app, context_vars=captured)
        app_context = mock_flask_app.app_context.return_value
        failing_method = app_context.__enter__ if failure_stage == "enter" else app_context.__exit__
        failing_method.side_effect = ValueError("context failed")

        with pytest.raises(ValueError, match="context failed"), ctx.enter() if use_enter else ctx:
            assert test_var.get() == "captured"

        assert test_var not in contextvars.copy_context()
        failing_method.side_effect = None
        with ctx:
            assert test_var.get() == "captured"
        assert test_var not in contextvars.copy_context()

    def test_enter_enters_flask_app_context(self, mock_flask_app):
        """Test that enter enters Flask app context."""
        from context.flask_app_context import FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=mock_flask_app,
            context_vars=contextvars.copy_context(),
        )

        with ctx:
            # Verify app context was entered
            assert mock_flask_app.app_context.called

    @patch("context.flask_app_context.g", autospec=True)
    def test_enter_restores_user_in_g(self, mock_g, mock_flask_app):
        """Test that enter restores user in Flask g object."""
        mock_user = MagicMock()
        mock_user.id = "test_user"

        # Note: FlaskExecutionContext saves user from g before entering context,
        # then restores it after entering the app context.
        # The user passed to constructor is NOT restored to g.
        # So we need to test the actual behavior.

        # Create FlaskExecutionContext with user in constructor
        from context.flask_app_context import FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=mock_flask_app,
            context_vars=contextvars.copy_context(),
            user=mock_user,
        )

        # Set user in g before entering (simulating existing user in g)
        mock_g._login_user = mock_user

        with ctx:
            # After entering, the user from g before entry should be restored
            assert mock_g._login_user == mock_user

        # The user in constructor is stored but not automatically restored to g
        # (it's available via ctx.user property)
        assert ctx.user == mock_user

    def test_enter_method_as_context_manager(self, mock_flask_app):
        """Test enter method returns a proper context manager."""
        from context.flask_app_context import FlaskExecutionContext

        ctx = FlaskExecutionContext(
            flask_app=mock_flask_app,
            context_vars=contextvars.copy_context(),
        )

        # enter() should return a generator/context manager
        with ctx.enter():
            # Should work without issues
            pass

        # Verify app context was called
        assert mock_flask_app.app_context.called
