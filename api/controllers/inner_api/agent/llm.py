"""Trusted streaming LLM gateway for dify-agent runs."""

from __future__ import annotations

import json
import logging
from collections.abc import Generator

from flask import Response, stream_with_context
from flask_restx import Resource
from pydantic import ValidationError

from controllers.common.schema import register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import agent_inner_api_only
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.plugin.impl.agent_llm_errors import normalize_agent_llm_plugin_error
from core.plugin.impl.exc import (
    PluginDaemonClientSideError,
    PluginDaemonError,
    PluginDaemonNotFoundError,
    PluginDaemonUnauthorizedError,
    PluginNotFoundError,
    PluginPermissionDeniedError,
)
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeError,
    InvokeRateLimitError,
)
from libs.exception import BaseHTTPException
from services.agent_llm_inner_service import AgentLLMInnerService, AgentLLMInnerServiceError
from services.entities.agent_llm_inner import AgentLLMInvokeRequest

logger = logging.getLogger(__name__)


def _normalize_gateway_error(error: Exception) -> BaseException:
    """Recover wrapped model errors and legacy plugin failures for gateway classification.

    Accept an invocation/preparation failure and follow only exact base InvokeError wrappers.
    Explicit InvokeErrors without a cause and named InvokeError subclasses retain their classification;
    repeated causes stop traversal. Plugin-client transport/protocol ValueErrors become daemon
    failures; the marked runtime preserves their causes before Graphon's ValueError self-rethrow.
    Callers log and chain the original error, keeping the full traceback available server-side.
    """
    target: BaseException = error
    seen = {id(target)}
    while type(target) is InvokeError and target.__cause__ is not None and id(target.__cause__) not in seen:
        target = target.__cause__
        seen.add(id(target))
    return normalize_agent_llm_plugin_error(target, from_plugin_stream=False) or target


def _preparation_error_status(
    error: InvokeError | PluginDaemonError | ProviderTokenNotInitError | ModelCurrentlyNotSupportError,
) -> int:
    """Map a classified model/plugin preparation failure to its gateway HTTP status."""
    if isinstance(error, PluginDaemonNotFoundError | PluginNotFoundError):
        return 404
    if isinstance(error, PluginDaemonUnauthorizedError | InvokeAuthorizationError):
        return 401
    if isinstance(error, PluginPermissionDeniedError):
        return 403
    if isinstance(error, InvokeRateLimitError):
        return 429
    if isinstance(error, PluginDaemonClientSideError | InvokeBadRequestError):
        return 400
    if isinstance(error, ProviderTokenNotInitError | ModelCurrentlyNotSupportError):
        return 400
    return 502


class AgentLLMInvokeHttpError(BaseHTTPException):
    error_code = "agent_llm_invoke_failed"
    description = "Agent LLM invocation failed."
    code = 500

    def __init__(self, *, error_code: str, description: str, status_code: int) -> None:
        self.error_code = error_code
        self.description = description
        self.code = status_code
        super().__init__(description)


register_schema_models(inner_api_ns, AgentLLMInvokeRequest)


@inner_api_ns.route("/agent/llm/invoke")
class AgentLLMInvokeApi(Resource):
    """Resolve one dify-agent model request before proxying it."""

    @agent_inner_api_only
    @inner_api_ns.doc("inner_agent_llm_invoke")
    @inner_api_ns.expect(inner_api_ns.models[AgentLLMInvokeRequest.__name__])
    @inner_api_ns.produces(["text/event-stream"])
    def post(self) -> Response:
        """Validate and prepare a trusted LLM request, then stream plugin-compatible envelopes.

        Expected preparation failures keep their HTTP mapping. Unexpected preparation or
        streaming failures log their traceback and caller correlation, exposing only a safe
        internal-error message. Graphon's generic InvokeError wrappers are unwrapped before
        classification; named model errors and clean, potentially JSON plugin descriptions survive.
        Legacy plugin transport/protocol failures retain daemon classification, while model setup
        errors use their description even when their ValueError text is empty.
        """
        try:
            payload = AgentLLMInvokeRequest.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise AgentLLMInvokeHttpError(
                error_code="invalid_request",
                description=str(exc),
                status_code=400,
            ) from exc

        service = AgentLLMInnerService()
        log_context = (
            payload.caller.agent_run_id,
            payload.caller.invocation_id,
            payload.caller.app_id,
            payload.target.provider,
            payload.target.model,
            payload.caller.trace_id,
        )
        try:
            prepared = service.prepare(payload)
        except AgentLLMInnerServiceError as exc:
            raise AgentLLMInvokeHttpError(
                error_code=exc.error_code,
                description=exc.description,
                status_code=exc.status_code,
            ) from exc
        except Exception as exc:
            target = _normalize_gateway_error(exc)
            if isinstance(target, QuotaExceededError):
                error_code = "agent_llm_quota_exceeded"
                description = str(target) or "Insufficient Message Credits."
                status_code = 429
            elif isinstance(
                target, InvokeError | PluginDaemonError | ProviderTokenNotInitError | ModelCurrentlyNotSupportError
            ):
                error_code = "agent_llm_invoke_failed"
                description = f"{type(target).__name__}: {target.description or 'Agent LLM invocation failed.'}"
                status_code = _preparation_error_status(target)
            elif isinstance(target, ValueError):
                error_code = "invalid_model_request"
                description = str(target)
                status_code = 400
            else:
                logger.exception(
                    "Agent LLM preparation failed: agent_run_id=%s invocation_id=%s app_id=%s "
                    "provider=%s model=%s trace_id=%s",
                    *log_context,
                )
                error_code = "agent_llm_internal_error"
                description = "Internal Server Error, please contact support."
                status_code = 500
            raise AgentLLMInvokeHttpError(
                error_code=error_code,
                description=description,
                status_code=status_code,
            ) from exc

        def generate() -> Generator[str]:
            try:
                for chunk in service.invoke(prepared):
                    # Agent owns its history. Do not reserialize opaque request
                    # messages through the runtime's typed PromptMessage field.
                    envelope = {
                        "code": 0,
                        "message": "",
                        "data": chunk.model_dump(mode="json", exclude={"prompt_messages"}),
                    }
                    yield f"data: {json.dumps(envelope, ensure_ascii=False, separators=(',', ':'))}\n\n"
            except GeneratorExit:
                raise
            except Exception as exc:
                logger.exception(
                    "Agent LLM stream failed: agent_run_id=%s invocation_id=%s app_id=%s "
                    "provider=%s model=%s trace_id=%s",
                    *log_context,
                )
                target = _normalize_gateway_error(exc)
                code = -500
                if isinstance(target, QuotaExceededError):
                    code = -429
                    error = {
                        "error_type": "AgentLLMQuotaExceededError",
                        "message": str(target) or "Insufficient hosted model quota remaining.",
                    }
                elif isinstance(
                    target, InvokeError | PluginDaemonError | ProviderTokenNotInitError | ModelCurrentlyNotSupportError
                ):
                    error = {
                        "error_type": type(target).__name__,
                        "message": target.description or "Agent LLM invocation failed.",
                    }
                elif isinstance(target, ValueError):
                    error = {
                        "error_type": type(target).__name__,
                        "message": str(target) or "Agent LLM invocation failed.",
                    }
                else:
                    error = {
                        "error_type": "AgentLLMInternalError",
                        "message": "Internal Server Error, please contact support.",
                    }
                envelope = {
                    "code": code,
                    "message": json.dumps(error, ensure_ascii=False, separators=(",", ":")),
                    "data": None,
                }
                yield f"data: {json.dumps(envelope, ensure_ascii=False, separators=(',', ':'))}\n\n"

        return Response(
            stream_with_context(generate()),  # pyrefly: ignore[no-matching-overload]
            content_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )


__all__ = ["AgentLLMInvokeApi", "AgentLLMInvokeHttpError"]
