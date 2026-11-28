"""Connector cause is diagnostic only; it cannot establish native execution evidence."""

import json

import pytest

from core.plugin.entities.plugin_daemon import PluginDaemonInnerError
from services.dify_builder import trace_diagnostics as diagnostics

PREFIX = (
    "Failed to activate plugin before invocation: unexpected response from serverless connector activation: status="
)
BODY = json.dumps({"error": "synthetic serviceaccount cannot patch leases token=secret https://private"})
MESSAGE = PREFIX + "500 body=" + BODY


def _typed(message: str = MESSAGE, code: int = -500) -> PluginDaemonInnerError:
    # Keyword construction deliberately does not populate Exception.args.
    return PluginDaemonInnerError(code=code, message=message)


def test_typed_activation_cause_is_bounded_and_does_not_depend_on_str() -> None:
    error = _typed()
    assert str(error) == ""
    assert diagnostics.failure_reason(error) == "service_unavailable"


@pytest.mark.parametrize(
    "error",
    [
        RuntimeError(MESSAGE),
        ValueError(json.dumps({"error_type": "PluginDaemonInnerError", "message": MESSAGE})),
        _typed(code=-400),
        _typed(PREFIX + "400 body=" + BODY),
        _typed(PREFIX + "5000 body=" + BODY),
        _typed("Code output: " + MESSAGE),
        _typed(PREFIX + "500 body=not-json"),
        _typed(PREFIX + '500 body={"error":{"message":"nested"}}'),
        _typed(PREFIX + '500 body=["error"]'),
        _typed(json.dumps({"error_type": "PluginDaemonInnerError", "message": MESSAGE})),
    ],
)
def test_text_and_malformed_envelopes_cannot_claim_activation(error: Exception) -> None:
    assert diagnostics.failure_reason(error) == "unknown"
