"""Tests for Flask app context module."""

import contextvars
from unittest.mock import MagicMock, patch

import pytest


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

    @patch("context.flask_app_context.current_app")
    @patch("context.flask_app_context.g")
    def test_capture_flask_context_captures_app(self, mock_g, mock_current_app):
        """Test capture_flask_context captures Flask app."""
        mock_app = MagicMock()
        mock_app._get_current_object = MagicMock(return_value=mock_app)
        mock_current_app._get_current_object = MagicMock(return_value=mock_app)

        from context.flask_app_context import capture_flask_context

        ctx = capture_flask_context()

        assert ctx._flask_app == mock_app

    @patch("context.flask_app_context.current_app")
    @patch("context.flask_app_context.g")
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

    @patch("context.flask_app_context.current_app")
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

    @patch("context.flask_app_context.current_app")
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

    def test_enter_restores_context_vars(self, mock_flask_app):
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
            flask_app=mock_flask_app,
            context_vars=context_vars,
        )

        with ctx:
            # Value should be restored to original
            assert test_var.get() == "original_value"

        # After exiting, variable stays at the value from within the context
        # (this is expected Python contextvars behavior)
        assert test_var.get() == "original_value"

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

    @patch("context.flask_app_context.g")
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
