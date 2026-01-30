"""
Quart App Context - Quart implementation of AppContext interface.
"""

import contextvars
import threading
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any, final

from quart import current_app, g

from core.workflow.context import register_context_capturer
from core.workflow.context.execution_context import (
    AppContext,
    IExecutionContext,
)
from dify_app import DifyApp


@final
class QuartAppContext(AppContext):
    """
    Quart implementation of AppContext.

    This adapts Quart's app context to the AppContext interface.
    """

    def __init__(self, quart_app: DifyApp) -> None:
        """
        Initialize Quart app context.

        Args:
            quart_app: The Quart application instance
        """
        self._quart_app = quart_app

    def get_config(self, key: str, default: Any = None) -> Any:
        """Get configuration value from Quart app config."""
        return self._quart_app.config.get(key, default)

    def get_extension(self, name: str) -> Any:
        """Get Quart extension by name."""
        return self._quart_app.extensions.get(name)

    @contextmanager
    def enter(self) -> Generator[None, None, None]:
        """Enter Quart app context."""
        with self._quart_app.app_context():
            yield

    @property
    def quart_app(self) -> DifyApp:
        """Get the underlying Quart app instance."""
        return self._quart_app


def capture_quart_context(user: Any = None) -> IExecutionContext:
    """
    Capture current Quart execution context.

    This function captures the Quart app context and contextvars from the
    current environment. It should be called from within a Quart request or
    app context.

    Args:
        user: Optional user object to include in context

    Returns:
        IExecutionContext with captured Quart context

    Raises:
        RuntimeError: If called outside Quart context
    """
    # Get Quart app instance
    quart_app = current_app._get_current_object()  # type: ignore

    # Save current user if available
    saved_user = user
    if saved_user is None:
        # Check for user in g (quart-login)
        if hasattr(g, "_login_user"):
            saved_user = g._login_user

    # Capture contextvars
    context_vars = contextvars.copy_context()

    return QuartExecutionContext(
        quart_app=quart_app,
        context_vars=context_vars,
        user=saved_user,
    )


@final
class QuartExecutionContext:
    """
    Quart-specific execution context.

    This is a specialized version of ExecutionContext that includes Quart app
    context. It provides the same interface as ExecutionContext but with
    Quart-specific implementation.
    """

    def __init__(
        self,
        quart_app: DifyApp,
        context_vars: contextvars.Context,
        user: Any = None,
    ) -> None:
        """
        Initialize Quart execution context.

        Args:
            quart_app: Quart application instance
            context_vars: Python contextvars
            user: Optional user object
        """
        self._app_context = QuartAppContext(quart_app)
        self._context_vars = context_vars
        self._user = user
        self._quart_app = quart_app
        self._local = threading.local()

    @property
    def app_context(self) -> QuartAppContext:
        """Get Quart app context."""
        return self._app_context

    @property
    def context_vars(self) -> contextvars.Context:
        """Get context variables."""
        return self._context_vars

    @property
    def user(self) -> Any:
        """Get user object."""
        return self._user

    def __enter__(self) -> "QuartExecutionContext":
        """Enter the Quart execution context."""
        # Restore non-Quart context variables to avoid leaking Quart tokens across threads
        for var, val in self._context_vars.items():
            var.set(val)

        # Enter Quart app context
        cm = self._app_context.enter()
        self._local.cm = cm
        cm.__enter__()

        # Restore user in new app context
        if self._user is not None:
            g._login_user = self._user

        return self

    def __exit__(self, *args: Any) -> None:
        """Exit the Quart execution context."""
        cm = getattr(self._local, "cm", None)
        if cm is not None:
            cm.__exit__(*args)

    @contextmanager
    def enter(self) -> Generator[None, None, None]:
        """Enter Quart execution context as context manager."""
        # Restore non-Quart context variables to avoid leaking Quart tokens across threads
        for var, val in self._context_vars.items():
            var.set(val)

        # Enter Quart app context
        with self._quart_app.app_context():
            # Restore user in new app context
            if self._user is not None:
                g._login_user = self._user
            yield


def init_quart_context() -> None:
    """
    Initialize Quart context capture by registering the capturer.

    This function should be called during Quart application initialization
    to register the Quart-specific context capturer with the core context module.

    Example:
        app = DifyApp(__name__)
        init_quart_context()  # Register Quart context capturer

    Note:
        This function does not need the app instance as it uses Quart's
        `current_app` to get the app when capturing context.
    """
    register_context_capturer(capture_quart_context)


# Backward-compatible aliases for legacy Flask naming.
FlaskAppContext = QuartAppContext
FlaskExecutionContext = QuartExecutionContext
capture_flask_context = capture_quart_context
init_flask_context = init_quart_context
