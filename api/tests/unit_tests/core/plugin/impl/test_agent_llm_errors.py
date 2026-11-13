"""Gateway normalization preserves model errors and recovers legacy daemon failures."""

import json

import pytest

from core.plugin.impl.agent_llm_errors import normalize_agent_llm_plugin_error
from core.plugin.impl.exc import PluginInvokeError


def test_legacy_daemon_message_survives_a_value_error_self_rethrow() -> None:
    """Graphon's legacy self-rethrow can discard the daemon cause but retain its fixed message."""
    error = ValueError("Request to Plugin Daemon Service failed-500")
    error.__cause__ = error

    normalized = normalize_agent_llm_plugin_error(error, from_plugin_stream=False)

    assert normalized is not None
    assert normalized.description == "Request to Plugin Daemon Service failed"


def test_model_value_error_with_a_cyclic_cause_keeps_its_original_classification() -> None:
    error = ValueError("temperature must be non-negative")
    error.__cause__ = error

    assert normalize_agent_llm_plugin_error(error, from_plugin_stream=False) is None


def test_named_plugin_invoke_error_keeps_its_client_error_classification() -> None:
    error = PluginInvokeError('{"error_type":"InvokeBadRequestError","message":"invalid model"}')

    assert normalize_agent_llm_plugin_error(error, from_plugin_stream=True) is None


@pytest.mark.parametrize("from_plugin_stream", [False, True])
def test_deserialization_error_is_a_protocol_failure_only_at_the_plugin_stream_boundary(
    from_plugin_stream: bool,
) -> None:
    """A parse failure outside plugin decoding must keep the model's ValueError contract."""
    error = ValueError("")
    error.__cause__ = json.JSONDecodeError("invalid JSON", "", 0)

    normalized = normalize_agent_llm_plugin_error(error, from_plugin_stream=from_plugin_stream)

    if from_plugin_stream:
        assert normalized is not None
        assert normalized.description == "Request to Plugin Daemon Service failed"
    else:
        assert normalized is None
