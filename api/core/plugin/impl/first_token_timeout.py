"""Per-node first-token budget for LLM invocations through the plugin daemon.

Configured as ``completion_params.first_token_timeout_ms`` and popped into
``ModelInstance.first_token_timeout`` by ``_normalize_completion_params`` -- the only
ms->s conversion, everything past that point is seconds. ``DifyPreparedLLM`` puts it on
``request_metadata`` for streaming invocations only, ``PluginModelRuntime`` reads it back
off, and ``PluginModelClient.invoke_llm`` sends it to the daemon as a request field.

Enforcement belongs to the plugin process, the only layer holding the provider
connection. The daemon re-enforces at ``budget + e`` and this side widens its read window
to ``budget + 2e`` when the configured one is shorter. Whichever rung fires is therefore
the innermost layer that knows why the call stalled, and the outer ones only come into
play when an inner one is wedged.
"""

from graphon.model_runtime.errors.invoke import InvokeError

FIRST_TOKEN_TIMEOUT_METADATA_KEY = "first_token_timeout"

_GRACE_FLOOR_SECONDS = 0.25
_GRACE_RATIO = 0.05


class FirstTokenTimeoutError(InvokeError):
    """The model did not stream its first token within the configured budget."""

    description = "The first streamed token was not received in time."


def first_token_grace(budget: float) -> float:
    """One rung of the deadline ladder, matching the daemon's own epsilon."""
    return max(_GRACE_FLOOR_SECONDS, budget * _GRACE_RATIO)


def first_token_backstop(budget: float) -> float:
    """Transport deadline for a request carrying ``budget``, two rungs out from it."""
    return budget + 2 * first_token_grace(budget)
