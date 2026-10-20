"""Process-level Logfire setup for the Dify Agent run server.

The run server performs observability setup at the FastAPI app boundary rather
than inside agent runtime code. Global instrumentations cover shared HTTPX and
Redis clients once per process; the FastAPI instrumentation is applied per app
instance because tests and embedded callers can build multiple apps in one
Python process. ``OTEL_*`` and ``LOGFIRE_*`` values captured in the
``ServerSettings`` dotenv snapshot are forwarded before SDK setup without
overriding the process environment. Logfire-platform export remains token-gated through
``if-token-present``; standard OTLP export is configured independently.

The optional Agent trajectory pipeline is a separate, deployment-opt-in Logfire
instance configured only from ``DIFY_AGENT_TRAJECTORY_*`` settings. It is
created while the inherited ``OTEL_*``/``LOGFIRE_*`` environment is temporarily
stripped so platform endpoints, credentials, and sampling never leak into the
Agent pipeline; the isolation is startup-only and does not coordinate external
code that mutates ``os.environ`` concurrently.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from threading import RLock
from typing import Any, Literal

import logfire
from fastapi import FastAPI, Request, WebSocket
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ALWAYS_ON, ParentBased

from dify_agent.runtime.observability import AgentObservability, IsolatedTracerProvider
from dify_agent.server.settings import ServerSettings

_global_instrumentation_ready = False
_global_trace_context_mode: Literal["isolated", "shared"] | None = None
_observability_configuration_lock = RLock()


@contextmanager
def _isolated_agent_environment() -> Iterator[None]:
    """Serialize SDK configuration and strip inherited SDK env for Agent setup."""
    with _observability_configuration_lock:
        inherited = {key: value for key, value in os.environ.items() if key.startswith(("OTEL_", "LOGFIRE_"))}
        for key in inherited:
            del os.environ[key]
        try:
            yield
        finally:
            for key in tuple(os.environ):
                if key.startswith(("OTEL_", "LOGFIRE_")):
                    del os.environ[key]
            os.environ.update(inherited)


def _platform_request_attributes(_request: Request | WebSocket, _attributes: dict[str, Any]) -> None:
    return None


def configure_server_observability(app: FastAPI, *, settings: ServerSettings | None = None) -> logfire.Logfire:
    """Configure Logfire and instrument the server's framework/client boundaries.

    Platform instrumentation captures infrastructure metadata without parsed
    request payloads or HTTP bodies. SDK environment variables
    are forwarded from the settings dotenv snapshot with process-environment
    priority.
    Logfire-platform export stays token-gated; OTLP endpoints do not require a
    Logfire token. FastAPI parsed argument/error payloads, HTTPX bodies and
    headers, and Redis statements are not captured. The trace context mode is a
    startup-only choice and cannot change after instrumentation. Returns the
    platform Logfire instance.
    """
    global _global_instrumentation_ready
    global _global_trace_context_mode

    resolved_settings = settings or ServerSettings()
    mode = resolved_settings.trajectory_trace_context_mode

    with _observability_configuration_lock:
        if _global_instrumentation_ready and _global_trace_context_mode != mode:
            raise ValueError("Trace context mode cannot change after platform instrumentation; restart the process")
        for key, value in resolved_settings.observability_dotenv.items():
            if key.startswith(("OTEL_", "LOGFIRE_")):
                os.environ.setdefault(key, value.get_secret_value())

        platform = logfire.configure(
            send_to_logfire="if-token-present",
            inspect_arguments=False,
        )

        tracer_provider: IsolatedTracerProvider | Any = (
            IsolatedTracerProvider(platform, preserve_external_parent=True)
            if mode == "isolated"
            else platform.config.get_tracer_provider()
        )
        if not _global_instrumentation_ready:
            platform.instrument_httpx(
                capture_all=False,
                capture_headers=False,
                capture_request_body=False,
                capture_response_body=False,
                tracer_provider=tracer_provider,
            )
            platform.instrument_redis(capture_statement=False, tracer_provider=tracer_provider)
            _global_instrumentation_ready = True
            _global_trace_context_mode = mode

        if getattr(app.state, "dify_agent_logfire_instrumented", False):
            return platform
        platform.instrument_fastapi(
            app,
            request_attributes_mapper=_platform_request_attributes,
            capture_headers=False,
            tracer_provider=tracer_provider,
        )
        app.state.dify_agent_logfire_instrumented = True
        return platform


def configure_agent_observability(settings: ServerSettings) -> AgentObservability | None:
    """Build the opt-in Agent trajectory pipeline from deployment settings only.

    This is one process-wide pipeline and is meant to stay that way. Per-tenant
    destinations belong in a routing ``SpanExporter`` that reads a span's
    ``dify.tenant_id`` and fans out to a cached per-tenant exporter, not in a
    tracer instance per tenant: a second instance costs another
    ``logfire.configure()``, which means another
    ``_isolated_agent_environment()`` window on a live process and another batch
    processor thread. Routing keeps setup static and makes a tenant destination
    plain data. Such a router must fail closed on an unknown tenant rather than
    fall back to this deployment-wide endpoint.
    """
    if not settings.trajectory_enabled:
        return None
    endpoint = settings.trajectory_otlp_traces_endpoint
    if endpoint is None:
        raise ValueError("trajectory_otlp_traces_endpoint is required when trajectory_enabled is true")
    with _isolated_agent_environment():
        exporter = OTLPSpanExporter(
            endpoint=str(endpoint),
            headers={key: value.get_secret_value() for key, value in settings.trajectory_otlp_headers.items()},
            timeout=5,
        )
        processor = BatchSpanProcessor(
            exporter,
            max_queue_size=settings.trajectory_max_queue_size,
            max_export_batch_size=settings.trajectory_max_export_batch_size,
            schedule_delay_millis=settings.trajectory_schedule_delay_ms,
            export_timeout_millis=settings.trajectory_export_timeout_ms,
        )
        try:
            client = logfire.configure(
                local=True,
                send_to_logfire=False,
                service_name=settings.trajectory_service_name,
                console=False,
                metrics=False,
                inspect_arguments=False,
                add_baggage_to_attributes=False,
                sampling=logfire.SamplingOptions(
                    head=ALWAYS_ON if settings.trajectory_trace_context_mode == "isolated" else ParentBased(ALWAYS_ON)
                ),
                additional_span_processors=[processor],
            )
        except BaseException:
            processor.shutdown()
            raise
    return AgentObservability(
        client=client,
        include_content=settings.trajectory_include_content,
        trace_context_mode=settings.trajectory_trace_context_mode,
    )


__all__ = [
    "AgentObservability",
    "configure_agent_observability",
    "configure_server_observability",
]
