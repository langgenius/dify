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
from typing import Any

from celery.signals import task_postrun, task_prerun
from opentelemetry import context
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

logger = logging.getLogger(__name__)
_TRACE_PROPAGATOR = TraceContextTextMapPropagator()

_SQLCOMMENTER_CONTEXT_KEY = "SQLCOMMENTER_ORM_TAGS_AND_VALUES"
_TOKEN_ATTR = "_dify_sqlcommenter_context_token"


def _build_celery_sqlcommenter_tags(task: Any) -> dict[str, str | int]:
    """Build SQL commenter tags from the current Celery task and OpenTelemetry context."""
    tags: dict[str, str | int] = {}

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
    if not task:
        return

    tags = _build_celery_sqlcommenter_tags(task)
    if not tags:
        return

    current = context.get_current()
    new_ctx = context.set_value(_SQLCOMMENTER_CONTEXT_KEY, tags, current)
    token = context.attach(new_ctx)
    setattr(task, _TOKEN_ATTR, token)


def _on_task_postrun(*args: object, **kwargs: object) -> None:
    task = kwargs.get("task")
    if not task:
        return

    token = getattr(task, _TOKEN_ATTR, None)
    if token is None:
        return

    try:
        context.detach(token)
    except Exception:
        logger.debug("Failed to detach SQL commenter context", exc_info=True)
    finally:
        try:
            delattr(task, _TOKEN_ATTR)
        except AttributeError:
            pass


def setup_celery_sqlcommenter() -> None:
    """
    Connect Celery task_prerun and task_postrun handlers to inject SQL comment
    context for worker queries. Call this from init_celery_worker after
    CeleryInstrumentor().instrument() so our handlers run after the OTEL
    instrumentor's and the trace context is already attached.
    """
    task_prerun.connect(_on_task_prerun, weak=False)
    task_postrun.connect(_on_task_postrun, weak=False)
