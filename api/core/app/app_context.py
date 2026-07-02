"""Request-scoped app context for model plugin dispatch.

Stores the current app_id in a ContextVar so that PluginModelRuntime
can include it in the HTTP payload to the plugin daemon, without
requiring changes to the graphon call chain.

Usage in app runners::

    from core.app.app_context import set_current_app_id

    token = set_current_app_id(app_id)
    try:
        invoke_result = model_instance.invoke_llm(...)
    finally:
        reset_current_app_id(token)

The value is read by PluginModelRuntime.invoke_llm() to tag the
request with the originating Dify app.
"""

from __future__ import annotations

from contextvars import ContextVar, Token

_current_app_id: ContextVar[str | None] = ContextVar("_current_app_id", default=None)


def get_current_app_id() -> str | None:
    """Return the app_id for the current execution context, or None."""
    return _current_app_id.get()


def set_current_app_id(app_id: str | None) -> Token[str | None]:
    """Set the app_id for the current execution context. Returns a token for reset."""
    return _current_app_id.set(app_id)


def reset_current_app_id(token: Token[str | None]) -> None:
    """Reset the app_id to its previous value."""
    _current_app_id.reset(token)
