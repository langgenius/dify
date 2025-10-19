import contextvars
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TypeVar

from flask import Flask, g

T = TypeVar("T")


@contextmanager
def preserve_flask_contexts(
    flask_app: Flask,
    context_vars: contextvars.Context,
) -> Iterator[None]:
    """
    A context manager that handles:
    1. flask-login's UserProxy copy
    2. ContextVars copy
    3. flask_app.app_context()

    This context manager ensures that the Flask application context is properly set up,
    the current user is preserved across context boundaries, and any provided context variables
    are set within the new context.

    Note:
        This manager aims to allow use current_user cross thread and app context,
        but it's not the recommend use, it's better to pass user directly in parameters.

    Args:
        flask_app: The Flask application instance
        context_vars: contextvars.Context object containing context variables to be set in the new context

    Yields:
        None

    Example:
        ```python
        with preserve_flask_contexts(flask_app, context_vars=context_vars):
            # Code that needs Flask app context and context variables
            # Current user will be preserved if available
        ```
    """
    # Set context variables if provided
    if context_vars:
        for var, val in context_vars.items():
            var.set(val)

    # Save current user before entering new app context
    saved_user = None
    # Check for user in g (works in both request context and app context)
    if hasattr(g, "_login_user"):
        saved_user = g._login_user

    # Enter Flask app context
    with flask_app.app_context():
        try:
            # Restore user in new app context if it was saved
            if saved_user is not None:
                g._login_user = saved_user

            # Yield control back to the caller
            yield
        finally:
            # Any cleanup can be added here if needed
            pass
