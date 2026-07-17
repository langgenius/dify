"""First-token timeout plumbing for LLM streaming through the plugin daemon.

Configured per model as ``completion_params.first_token_timeout_ms`` and popped into
``ModelInstance.first_token_timeout`` by ``_normalize_completion_params`` -- the only
ms->s conversion; everything below the pop point is seconds. ``DifyPreparedLLM`` sets
the ContextVar around invocation, and ``BasePluginClient._stream_request`` applies it
as the per-request httpx ``read`` timeout. The daemon sends neither response headers
nor keep-alives before the first token, so the read timeout measures
time-to-first-token directly.

The ContextVar only reaches the transport on the thread that set it; a
background-thread stream consumer would read ``None`` and the gate fails open.
"""

from contextvars import ContextVar

from graphon.model_runtime.errors.invoke import InvokeError


class FirstTokenTimeoutError(InvokeError):
    """The model did not stream its first token within the configured budget."""

    description = "The first streamed token was not received in time."


# Seconds; None or non-positive disables the gate.
first_token_timeout_ctx: ContextVar[float | None] = ContextVar("first_token_timeout", default=None)
