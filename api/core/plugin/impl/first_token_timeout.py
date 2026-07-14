"""First-token timeout plumbing for LLM streaming through the plugin daemon.

The timeout is configured per model in ``completion_params.first_token_timeout_ms``
(milliseconds). Dify pops it at the workflow model-config boundary
(``core.app.llm.model_access._normalize_completion_params``) into
``ModelInstance.first_token_timeout``, and the workflow LLM adapter
(``DifyPreparedLLM``) carries it down to the plugin-daemon transport through a
:class:`~contextvars.ContextVar`, so the intermediate model-runtime layers (which
don't take the value as a parameter) stay untouched.

Enforcement lives in the transport (``BasePluginClient._stream_request``): the value is
applied as httpx's per-request ``read`` timeout. The daemon withholds the HTTP response
headers until the model emits its first token and sends no heartbeat in the meantime, so
the ``read`` timeout measures time-to-first-token directly; on expiry httpx raises
``httpx.ReadTimeout`` and the transport surfaces it as ``FirstTokenTimeoutError``.

Units: the user-facing value (web UI field, ``completion_params``) is **milliseconds**;
everything downstream of the pop point -- ``ModelInstance.first_token_timeout``, this
ContextVar, and the float fed straight into ``httpx.Timeout(read=...)`` -- is **seconds**.
The ms->s conversion happens exactly once, in ``_normalize_completion_params``; do not
add another one.

Threading: the ContextVar only reaches the transport when ``_stream_request`` runs in the same
thread/context that ``_guarded_stream`` set it in. A future model-runtime layer that prefetches
the SSE stream on a background thread would read the default (``None``), so the gate silently
disables -- fail-open: no false timeouts, just no enforcement.
"""

from contextvars import ContextVar

from graphon.model_runtime.errors.invoke import InvokeError


class FirstTokenTimeoutError(InvokeError):
    """The model did not stream its first token within the configured budget."""

    description = "The first streamed token was not received in time."


# Seconds to wait for the first streamed token; ``None`` (or non-positive) disables the gate.
# Set by the workflow LLM adapter around the invoke generator, read in ``_stream_request``.
first_token_timeout_ctx: ContextVar[float | None] = ContextVar("first_token_timeout", default=None)
