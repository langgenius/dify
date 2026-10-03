import contextvars
from collections.abc import Generator
from contextlib import contextmanager
from typing import TYPE_CHECKING

from flask import Flask, g

from libs.contextvars import use_contextvars

if TYPE_CHECKING:
    from models import Account, EndUser


@contextmanager
def preserve_flask_contexts(
    flask_app: Flask,
    context_vars: contextvars.Context,
) -> Generator[None, None, None]:
    """
    A context manager that handles:
    1. flask-login's UserProxy copy
    2. ContextVars copy
    3. flask_app.app_context()

    This context manager ensures that the Flask application context is properly set up,
    the current user is preserved across context boundaries, and any provided context variables
    are set within the new context. Caller bindings are restored after Flask cleanup.

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
    with use_contextvars(context_vars):
        # Read the captured user before creating a fresh Flask app context.
        saved_user = g.get("_login_user")
        with flask_app.app_context():
            if saved_user is not None:
                g._login_user = saved_user
            yield


def set_login_user(user: "Account | EndUser"):
    g._login_user = user
