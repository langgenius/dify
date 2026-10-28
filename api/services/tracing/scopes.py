"""Decide which executions are traced and give their producers a scope.

Deciding costs nothing extra on the request path: generators already hold
the app's tracing policy, so no configuration is decrypted and no provider is
loaded while a user waits.
"""

import logging
from collections.abc import Callable
from typing import Protocol

from dify_trace_sdk.emitter import TraceEmitter, TraceScope
from dify_trace_sdk.events import TraceCorrelation

from services.app_tracing_config_service import AppTraceSettings

logger = logging.getLogger(__name__)

UNCORRELATED = TraceCorrelation(external_trace_id=None, session_id=None, parent=None)
"""The correlation of an operation that carries no caller-supplied trace context."""


class TracingPolicyQuery(Protocol):
    def policy(self, *, tenant_id: str, app_id: str) -> AppTraceSettings | None:
        """The app's stored tracing policy; ``None`` when the app is not in the workspace.

        A stored policy that cannot be read is a disabled policy.
        """
        ...


class TraceScopes:
    """Create trace scopes for executions whose events someone consumes."""

    def __init__(
        self, *, emitter: TraceEmitter, policies: TracingPolicyQuery, enterprise_enabled: Callable[[], bool]
    ) -> None:
        self._emitter = emitter
        self._policies = policies
        self._enterprise_enabled = enterprise_enabled

    def for_execution(
        self,
        *,
        tenant_id: str,
        app_id: str | None,
        policy: AppTraceSettings,
        user_id: str | None,
        correlation: TraceCorrelation,
    ) -> TraceScope | None:
        """The scope of an execution whose app policy the caller holds; ``None`` when nobody consumes it."""
        if not ((policy.enabled and policy.tracing_provider is not None) or self._enterprise_enabled()):
            return None
        return TraceScope(
            emitter=self._emitter,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
            correlation=correlation,
        )

    def for_app(
        self, *, tenant_id: str, app_id: str | None, user_id: str | None, correlation: TraceCorrelation
    ) -> TraceScope | None:
        """A scope for callers that do not hold the app row; tracing failures stay out of the request."""
        policy = AppTraceSettings()
        if app_id is not None:
            try:
                policy = self._policies.policy(tenant_id=tenant_id, app_id=app_id) or policy
            except Exception:
                logger.warning("Tracing policy lookup failed: app_id=%s", app_id, exc_info=True)
                return None
        return self.for_execution(
            tenant_id=tenant_id, app_id=app_id, policy=policy, user_id=user_id, correlation=correlation
        )
