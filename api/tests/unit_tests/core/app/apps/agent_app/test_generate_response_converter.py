"""Agent V2 errors retain public failure classification and runtime correlation."""

from collections.abc import Generator

import pytest
from dify_agent.protocol import RunFailureType

from clients.agent_backend import AgentBackendRunFailedInternalEvent
from clients.agent_backend.errors import AgentBackendError, AgentBackendRunFailedError
from core.app.apps.agent_app.app_runner import _agent_backend_failure_to_exception
from core.app.apps.agent_app.generate_response_converter import AgentAppGenerateResponseConverter
from core.app.entities.task_entities import AppStreamResponse, ChatbotAppStreamResponse, ErrorStreamResponse
from core.plugin.impl.exc import PluginInvokeError, PluginRuntimeError
from graphon.model_runtime.errors.invoke import InvokeError


@pytest.mark.parametrize("full_response", [False, True])
def test_provider_failure_stream_preserves_task_and_backend_context(full_response: bool) -> None:
    error = _agent_backend_failure_to_exception(
        AgentBackendRunFailedInternalEvent(run_id="run-1", error="", reason="InvokeRateLimitError")
    )

    def stream() -> Generator[AppStreamResponse]:
        yield ChatbotAppStreamResponse(
            conversation_id="conversation-1",
            message_id="message-1",
            created_at=1,
            stream_response=ErrorStreamResponse(task_id="task-1", err=error),
        )

    convert = (
        AgentAppGenerateResponseConverter.convert_stream_full_response
        if full_response
        else AgentAppGenerateResponseConverter.convert_stream_simple_response
    )
    assert list(convert(stream())) == [
        {
            "event": "error",
            "conversation_id": "conversation-1",
            "message_id": "message-1",
            "created_at": 1,
            "task_id": "task-1",
            "code": "rate_limit_error",
            "status": 429,
            "message": "Rate Limit Error",
            "details": {
                "error_source": "model_provider",
                "agent_run_id": "run-1",
                "reason": "InvokeRateLimitError",
            },
        }
    ]


@pytest.mark.parametrize(
    ("error", "details"),
    [
        (
            AgentBackendError("lost", run_id="run-1", reason="binding_lost"),
            {"error_source": "agent_backend", "agent_run_id": "run-1", "reason": "binding_lost"},
        ),
        (
            AgentBackendRunFailedError("run-1", {}, error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED),
            {"error_source": "agent_backend", "agent_run_id": "run-1", "error_type": "agent_run_limit_exceeded"},
        ),
        (
            PluginRuntimeError("daemon unavailable"),
            {"error_source": "plugin_daemon", "error_type": "PluginRuntimeError"},
        ),
        (
            PluginInvokeError('{"error_type":"ModelMissing","message":"model missing"}'),
            {"error_source": "plugin_daemon", "error_type": "ModelMissing"},
        ),
        (PluginInvokeError("opaque failure"), {"error_source": "plugin_daemon", "error_type": "PluginInvokeError"}),
        (
            PluginInvokeError('{"error_type":"","message":"failed"}'),
            {"error_source": "plugin_daemon", "error_type": "PluginInvokeError"},
        ),
        (InvokeError(), {"error_source": "model_provider"}),
        (RuntimeError("private detail"), {"error_source": "internal"}),
    ],
)
def test_failure_diagnostics_omit_empty_fields_and_unknown_python_types(
    error: Exception, details: dict[str, str]
) -> None:
    assert AgentAppGenerateResponseConverter._error_to_stream_response(error)["details"] == details


def test_internal_failure_keeps_origin_and_sanitization_across_a_cyclic_cause_chain() -> None:
    error = RuntimeError("private gateway detail")
    backend_error = AgentBackendRunFailedError(
        "run-1",
        {},
        reason="private internal reason",
        error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
    )
    error.__cause__ = backend_error
    backend_error.__cause__ = error
    response = AgentAppGenerateResponseConverter._error_to_stream_response(error)
    assert response == {
        "code": "internal_server_error",
        "status": 500,
        "message": "Internal Server Error, please contact support.",
        "details": {"error_source": "internal", "agent_run_id": "run-1"},
    }


@pytest.mark.parametrize(
    ("reason", "code", "source"),
    [
        ("PluginRuntimeError", "plugin_runtime_error", "plugin_daemon"),
        ("AgentLLMQuotaExceededError", "provider_quota_exceeded", "model_provider"),
        ("InvokeError", "completion_request_error", "model_provider"),
    ],
)
def test_translated_failure_retains_backend_reason_without_changing_origin(reason: str, code: str, source: str) -> None:
    error = _agent_backend_failure_to_exception(
        AgentBackendRunFailedInternalEvent(run_id="run-1", error="upstream failure", reason=reason)
    )
    response = AgentAppGenerateResponseConverter._error_to_stream_response(error)
    assert response["code"] == code
    details = response["details"]
    assert isinstance(details, dict)
    assert details["error_source"] == source
    assert details["reason"] == reason
    assert details["agent_run_id"] == "run-1"
