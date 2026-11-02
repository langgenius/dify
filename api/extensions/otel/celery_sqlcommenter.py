"""
Celery SQL comment context for OpenTelemetry SQLCommenter.

Injects Celery-specific metadata (framework, task_name, traceparent, celery_retries,
routing_key) into SQL comments for queries executed by Celery workers. This improves
trace-to-SQL correlation and debugging in production.

Uses the OpenTelemetry context key SQLCOMMENTER_ORM_TAGS_AND_VALUES, which is read
by opentelemetry.instrumentation.sqlcommenter_utils._add_framework_tags() when the
SQLAlchemy instrumentor appends comments to SQL statements.
"""

import logging
from typing import Any, TypedDict

from celery.app.task import Task
from celery.signals import task_postrun, task_prerun
from opentelemetry import context
from opentelemetry.instrumentation.celery import CeleryInstrumentor
from opentelemetry.metrics import MeterProvider
from opentelemetry.trace import TracerProvider
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

logger = logging.getLogger(__name__)
_TRACE_PROPAGATOR = TraceContextTextMapPropagator()

_SQLCOMMENTER_CONTEXT_KEY = "SQLCOMMENTER_ORM_TAGS_AND_VALUES"
_TOKEN_ATTR = "_dify_sqlcommenter_context_token"


class CelerySqlcommenterTagsDict(TypedDict, total=False):
    framework: str
    task_name: str
    traceparent: str
    celery_retries: int
    routing_key: str


def _build_celery_sqlcommenter_tags(task: Any) -> CelerySqlcommenterTagsDict:
    """Build SQL commenter tags from the current Celery task and OpenTelemetry context."""
    tags: CelerySqlcommenterTagsDict = {}

    try:
        tags["framework"] = f"celery:{_get_celery_version()}"
    except Exception:
        tags["framework"] = "celery:unknown"

    if task and getattr(task, "name", None):
        tags["task_name"] = str(task.name)

    traceparent = _get_traceparent()
    if traceparent:
        tags["traceparent"] = traceparent

    if task and hasattr(task, "request"):
        request = task.request
        retries = getattr(request, "retries", None)
        if retries is not None and retries > 0:
            tags["celery_retries"] = int(retries)

        delivery_info = getattr(request, "delivery_info", None) or {}
        if isinstance(delivery_info, dict):
            routing_key = delivery_info.get("routing_key")
            if routing_key:
                tags["routing_key"] = str(routing_key)

    return tags


def _get_celery_version() -> str:
    import celery

    return getattr(celery, "__version__", "unknown")


def _get_traceparent() -> str | None:
    """Extract traceparent from the current OpenTelemetry context."""
    carrier: dict[str, str] = {}
    _TRACE_PROPAGATOR.inject(carrier)
    return carrier.get("traceparent")


def _on_task_prerun(*args: object, **kwargs: object) -> None:
    task = kwargs.get("task")
    if not isinstance(task, Task):
        return

    tags = _build_celery_sqlcommenter_tags(task)
    if not tags:
        return

    current = context.get_current()
    new_ctx = context.set_value(_SQLCOMMENTER_CONTEXT_KEY, tags, current)
    token = context.attach(new_ctx)
    # Celery reuses one Task instance across concurrent invocations. Its request
    # is execution-local, so another invocation cannot overwrite this token.
    setattr(task.request, _TOKEN_ATTR, token)


def _on_task_postrun(*args: object, **kwargs: object) -> None:
    task = kwargs.get("task")
    if not isinstance(task, Task):
        return

    request = task.request
    token = getattr(request, _TOKEN_ATTR, None)
    if token is None:
        return

    delattr(request, _TOKEN_ATTR)
    context.detach(token)


def setup_celery_sqlcommenter(*, tracer_provider: TracerProvider, meter_provider: MeterProvider) -> None:
    """
    Install Celery instrumentation with SQL comments inside its activation scope.

    Celery invokes signal receivers in registration order. The SQL context must
    attach after OTel's task span is active, then detach before OTel restores its
    parent. Registering both handlers after instrument() would restore an ended
    task span during postrun instead of leaving the caller's context intact.
    """
    instrumentor = CeleryInstrumentor()
    if instrumentor.is_instrumented_by_opentelemetry:
        # Auto-instrumentation may already own the signal order and providers.
        # Keep its spans intact rather than add a context we cannot unwind first.
        logger.warning("Celery is already instrumented; skipping SQL commenter signal registration")
        return

    task_postrun.connect(_on_task_postrun, weak=False)
    instrumentor.instrument(tracer_provider=tracer_provider, meter_provider=meter_provider)
    task_prerun.connect(_on_task_prerun, weak=False)
