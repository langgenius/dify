"""The request-path side of the trace pipeline.

Deciding whether to trace costs nothing extra: generators already hold the
app's tracing policy, so no configuration is decrypted and no provider is
loaded while a user waits. Events go straight to the delivery worker; large
ones travel through storage instead of the broker.
"""

import json
import logging
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any, override

from celery import current_app as celery_app
from dify_trace_sdk.emitter import TraceEmitter, TraceScope
from dify_trace_sdk.events import TraceCorrelation, TraceEvent
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.helper.trace_id_helper import ParentTraceContext
from extensions.ext_storage import storage
from models.model import App

logger = logging.getLogger(__name__)

DELIVER_TASK = "tasks.trace_delivery_task.deliver_trace_event"
TRACE_QUEUE = "ops_trace"
PAYLOAD_PREFIX = "trace_payloads"
INLINE_EVENT_BYTES = 256 * 1024
# Node executions may be saved by another worker after their run row; give them time to land.
WORKFLOW_SETTLE_SECONDS = 5


def payload_key(day: datetime, kind: str, identifier: str) -> str:
    """Storage key for a trace payload; the date prefix lets the sweeper expire it."""
    return f"{PAYLOAD_PREFIX}/{day:%Y-%m-%d}/{kind}/{identifier}.json"


def tracing_policy_enabled(app_tracing: str | None) -> bool:
    if not app_tracing:
        return False
    try:
        policy = json.loads(app_tracing)
    except ValueError:
        return False
    return (
        isinstance(policy, dict) and policy.get("enabled") is True and isinstance(policy.get("tracing_provider"), str)
    )


def correlation_from_extras(extras: Mapping[str, Any]) -> TraceCorrelation:
    parent = extras.get("parent_trace_context")
    if isinstance(parent, Mapping):
        try:
            parent = ParentTraceContext.model_validate(parent)
        except ValueError:
            parent = None
    external_trace_id, session_id = extras.get("external_trace_id"), extras.get("trace_session_id")
    return TraceCorrelation(
        external_trace_id=external_trace_id if isinstance(external_trace_id, str) and external_trace_id else None,
        session_id=session_id if isinstance(session_id, str) and session_id else None,
        parent_workflow_run_id=parent.parent_workflow_run_id if isinstance(parent, ParentTraceContext) else None,
        parent_node_execution_id=parent.parent_node_execution_id if isinstance(parent, ParentTraceContext) else None,
    )


class CeleryTraceEmitter(TraceEmitter):
    @override
    def emit(self, event: TraceEvent) -> None:
        encoded = event.model_dump_json()
        if len(encoded.encode()) > INLINE_EVENT_BYTES:
            key = payload_key(event.occurred_at, "events", event.event_id)
            storage.save(key, encoded.encode())
            envelope = {"payload_key": key}
        else:
            envelope = {"event": encoded}
        countdown = WORKFLOW_SETTLE_SECONDS if event.payload.kind == "workflow_run" else 0
        celery_app.send_task(DELIVER_TASK, args=(envelope,), queue=TRACE_QUEUE, countdown=countdown)


class TraceScopes:
    """Create trace scopes for executions whose events someone consumes."""

    def __init__(
        self,
        *,
        emitter: TraceEmitter,
        session_factory: sessionmaker[Session],
        enterprise_enabled: Callable[[], bool],
    ) -> None:
        self._emitter = emitter
        self._sessions = session_factory
        self._enterprise_enabled = enterprise_enabled

    def __call__(
        self,
        *,
        tenant_id: str,
        app_id: str | None,
        app_tracing: str | None,
        user_id: str | None,
        extras: Mapping[str, Any],
    ) -> TraceScope | None:
        if not (tracing_policy_enabled(app_tracing) or self._enterprise_enabled()):
            return None
        return TraceScope(
            emitter=self._emitter,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
            correlation=correlation_from_extras(extras),
        )

    def for_app(
        self, *, tenant_id: str, app_id: str | None, user_id: str | None, extras: Mapping[str, Any]
    ) -> TraceScope | None:
        """A scope for callers that do not hold the app row; tracing failures stay out of the request."""
        app_tracing = None
        if app_id is not None:
            try:
                with self._sessions() as session:
                    app_tracing = session.scalar(
                        select(App.tracing).where(App.id == app_id, App.tenant_id == tenant_id)
                    )
            except Exception:
                logger.warning("Tracing policy lookup failed: app_id=%s", app_id, exc_info=True)
                return None
        return self(tenant_id=tenant_id, app_id=app_id, app_tracing=app_tracing, user_id=user_id, extras=extras)
