"""
Flask App Context - Flask implementation of AppContext interface.
"""

import contextvars
import threading
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any, final

from flask import Flask, current_app, g

from core.workflow.context import register_context_capturer
from core.workflow.context.execution_context import (
    AppContext,
    IExecutionContext,
)


@final
class FlaskAppContext(AppContext):
    """
    Flask implementation of AppContext.

    This adapts Flask's app context to the AppContext interface.
    """

    def __init__(self, flask_app: Flask) -> None:
        """
        Initialize Flask app context.

        Args:
            flask_app: The Flask application instance
        """
        self._flask_app = flask_app

    def get_config(self, key: str, default: Any = None) -> Any:
        """Get configuration value from Flask app config."""
        return self._flask_app.config.get(key, default)

    def get_extension(self, name: str) -> Any:
        """Get Flask extension by name."""
        return self._flask_app.extensions.get(name)

    @contextmanager
    def enter(self) -> Generator[None, None, None]:
        """Enter Flask app context."""
        with self._flask_app.app_context():
            yield

    @property
    def flask_app(self) -> Flask:
        """Get the underlying Flask app instance."""
        return self._flask_app


def capture_flask_context(user: Any = None) -> IExecutionContext:
    """
    Capture current Flask execution context.

    This function captures the Flask app context and contextvars from the
    current environment. It should be called from within a Flask request or
    app context.

    Args:
        user: Optional user object to include in context

    Returns:
        IExecutionContext with captured Flask context

    Raises:
        RuntimeError: If called outside Flask context
    """
    # Get Flask app instance
    flask_app = current_app._get_current_object()  # type: ignore

    # Save current user if available
    saved_user = user
    if saved_user is None:
        # Check for user in g (flask-login)
        if hasattr(g, "_login_user"):
            saved_user = g._login_user

    # Capture contextvars
    context_vars = contextvars.copy_context()

    return FlaskExecutionContext(
        flask_app=flask_app,
        context_vars=context_vars,
        user=saved_user,
    )


@final
class FlaskExecutionContext:
    """
    Flask-specific execution context.

    This is a specialized version of ExecutionContext that includes Flask app
    context. It provides the same interface as ExecutionContext but with
    Flask-specific implementation.
    """

    def __init__(
        self,
        flask_app: Flask,
        context_vars: contextvars.Context,
        user: Any = None,
    ) -> None:
        """
        Initialize Flask execution context.

        Args:
            flask_app: Flask application instance
            context_vars: Python contextvars
            user: Optional user object
        """
        self._app_context = FlaskAppContext(flask_app)
        self._context_vars = context_vars
        self._user = user
        self._flask_app = flask_app
        self._local = threading.local()

    @property
    def app_context(self) -> FlaskAppContext:
        """Get Flask app context."""
        return self._app_context

    @property
    def context_vars(self) -> contextvars.Context:
        """Get context variables."""
        return self._context_vars

    @property
    def user(self) -> Any:
        """Get user object."""
        return self._user

    def __enter__(self) -> "FlaskExecutionContext":
        """Enter the Flask execution context."""
        # Restore non-Flask context variables to avoid leaking Flask tokens across threads
        for var, val in self._context_vars.items():
            var.set(val)

        # Enter Flask app context
        cm = self._app_context.enter()
        self._local.cm = cm
        cm.__enter__()

        # Restore user in new app context
        if self._user is not None:
            g._login_user = self._user

        return self

    def __exit__(self, *args: Any) -> None:
        """Exit the Flask execution context."""
        cm = getattr(self._local, "cm", None)
        if cm is not None:
            cm.__exit__(*args)

    @contextmanager
    def enter(self) -> Generator[None, None, None]:
        """Enter Flask execution context as context manager."""
        # Restore non-Flask context variables to avoid leaking Flask tokens across threads
        for var, val in self._context_vars.items():
            var.set(val)

        # Enter Flask app context
        with self._flask_app.app_context():
            # Restore user in new app context
            if self._user is not None:
                g._login_user = self._user
            yield


def init_flask_context() -> None:
    """
    Initialize Flask context capture by registering the capturer.

    This function should be called during Flask application initialization
    to register the Flask-specific context capturer with the core context module.

    Example:
        app = Flask(__name__)
        init_flask_context()  # Register Flask context capturer

    Note:
        This function does not need the app instance as it uses Flask's
        `current_app` to get the app when capturing context.
    """
    register_context_capturer(capture_flask_context)
