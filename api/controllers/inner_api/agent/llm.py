"""Trusted streaming LLM gateway for dify-agent runs."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Generator

from flask import Response, stream_with_context
from flask_restx import Resource
from pydantic import ValidationError

from controllers.common.schema import register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import agent_inner_api_only
from core.errors.error import QuotaExceededError
from libs.exception import BaseHTTPException
from services.agent_llm_inner_service import AgentLLMInnerService, AgentLLMInnerServiceError
from services.entities.agent_llm_inner import AgentLLMInvokeRequest

logger = logging.getLogger(__name__)
_HEARTBEAT_INTERVAL_SECONDS = 60


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
    """Resolve and meter one dify-agent model request before proxying it."""

    @agent_inner_api_only
    @inner_api_ns.doc("inner_agent_llm_invoke")
    @inner_api_ns.expect(inner_api_ns.models[AgentLLMInvokeRequest.__name__])
    @inner_api_ns.produces(["text/event-stream"])
    def post(self) -> Response:
        try:
            payload = AgentLLMInvokeRequest.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise AgentLLMInvokeHttpError(
                error_code="invalid_request",
                description=str(exc),
                status_code=400,
            ) from exc

        service = AgentLLMInnerService()
        try:
            prepared = service.prepare(payload)
            service.mark_running(prepared.invocation_id)
        except AgentLLMInnerServiceError as exc:
            raise AgentLLMInvokeHttpError(
                error_code=exc.error_code,
                description=exc.description,
                status_code=exc.status_code,
            ) from exc
        except QuotaExceededError as exc:
            raise AgentLLMInvokeHttpError(
                error_code="agent_llm_quota_exceeded",
                description=str(exc) or "Insufficient Message Credits.",
                status_code=429,
            ) from exc
        except ValueError as exc:
            raise AgentLLMInvokeHttpError(
                error_code="invalid_model_request",
                description=str(exc),
                status_code=400,
            ) from exc

        def generate() -> Generator[str, None, None]:
            usage = None
            last_heartbeat = time.monotonic()
            try:
                for chunk in service.invoke(prepared):
                    now = time.monotonic()
                    if now - last_heartbeat >= _HEARTBEAT_INTERVAL_SECONDS:
                        try:
                            service.heartbeat(prepared.invocation_id)
                        except Exception:
                            logger.exception("Failed to heartbeat Agent LLM invocation %s", prepared.invocation_id)
                        last_heartbeat = now
                    if chunk.delta.usage is not None:
                        usage = chunk.delta.usage
                    envelope = {"code": 0, "message": "", "data": chunk.model_dump(mode="json")}
                    yield f"data: {json.dumps(envelope, ensure_ascii=False, separators=(',', ':'))}\n\n"
                service.mark_succeeded(prepared.invocation_id, usage)
            except GeneratorExit as exc:
                service.mark_failed(prepared.invocation_id, exc, usage)
                raise
            except Exception as exc:
                service.mark_failed(prepared.invocation_id, exc, usage)
                error = {
                    "error_type": type(exc).__name__,
                    "message": str(exc) or "Agent LLM invocation failed.",
                }
                envelope = {
                    "code": -500,
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
