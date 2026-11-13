"""Response converter for the Agent App type.

The Agent App reuses the agent-chat response shape and adds compact failure
diagnostics. Runtime correlation is recovered from exception causes, while
unclassified internal exception names stay server-side.
"""

from typing import override

from pydantic import JsonValue

from clients.agent_backend.errors import AgentBackendError, AgentBackendRunFailedError
from core.app.apps.agent_app.errors import iter_error_causes
from core.app.apps.agent_chat.generate_response_converter import AgentChatAppGenerateResponseConverter
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.plugin.impl.exc import PluginDaemonError, PluginInvokeError
from graphon.model_runtime.errors.invoke import InvokeError


class AgentAppGenerateResponseConverter(AgentChatAppGenerateResponseConverter):
    """Serialize Agent V2 responses with public failure origin and runtime correlation."""

    @classmethod
    @override
    def _error_to_stream_response(cls, e: Exception) -> dict[str, JsonValue]:
        """Add compact ``details`` without changing the public code/status/message.

        The outer classified failure fixes ``error_source`` and optional error_type. Backend
        causes supplement nonempty agent_run_id and reason without changing that classification.
        ``internal_server_error`` stays internal: causes only add agent_run_id, never reason/error_type.
        """
        response = super()._error_to_stream_response(e)
        details: dict[str, JsonValue] = {"error_source": "internal"}
        internal_error = response.get("code") == "internal_server_error"
        if not internal_error:
            if isinstance(
                e, InvokeError | ProviderTokenNotInitError | QuotaExceededError | ModelCurrentlyNotSupportError
            ):
                details["error_source"] = "model_provider"
            elif isinstance(e, PluginDaemonError):
                details["error_source"] = "plugin_daemon"
                error_type = e.get_error_type() if isinstance(e, PluginInvokeError) else None
                details["error_type"] = error_type if error_type and error_type != "unknown" else type(e).__name__
            elif isinstance(e, AgentBackendError):
                details["error_source"] = "agent_backend"
                if isinstance(e, AgentBackendRunFailedError) and e.error_type:
                    details["error_type"] = e.error_type.value
        for error in iter_error_causes(e):
            if isinstance(error, AgentBackendError):
                if error.run_id:
                    details.setdefault("agent_run_id", error.run_id)
                if not internal_error and error.reason:
                    details.setdefault("reason", error.reason)
        response["details"] = details
        return response


__all__ = ["AgentAppGenerateResponseConverter"]
