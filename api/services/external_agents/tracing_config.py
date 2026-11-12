"""External-asset tracing owners and immutable, independently delivered targets.

No hidden App owns an external asset's credentials. Source App and asset targets
freeze independently; target policy cannot broaden source content policy. Only
the injected provider gateway/sender performs I/O, outside repository writes.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol

from dify_trace_sdk.errors import ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.ids import span_id_for, trace_id_for
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.provider import SendResult

from machinery.context import RequestContext
from services.app_tracing_config_service import PresentedTracingConfig
from services.external_agents.observability import (
    ExternalObservationAccess,
    InvocationObservationOwner,
    ObservationConflictError,
    ObservationExpiredError,
    ObservationNotFoundError,
    TraceSnapshot,
    aware_utc,
)


@dataclass(frozen=True, slots=True)
class StoredExternalTracingConfig:
    provider: str
    revision: int
    enabled: bool
    capture_content: bool
    encrypted_config: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class ExternalTracingConfiguration:
    provider: str
    revision: int
    enabled: bool
    capture_content: bool
    values: Mapping[str, Any]
    configured_secrets: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ExternalTracingProviderState:
    """Configured destination state, deliberately excluding all provider values."""

    provider: str
    revision: int
    enabled: bool
    capture_content: bool


@dataclass(frozen=True, slots=True)
class ExternalTracingProviderOverview:
    enabled_provider: str | None
    providers: tuple[ExternalTracingProviderState, ...]


@dataclass(frozen=True, slots=True)
class FrozenExternalTraceTarget:
    tenant_id: str
    invocation_id: str
    kind: Literal["asset", "app"]
    owner_id: str
    provider: str
    config_revision: str
    encrypted_config: Mapping[str, Any]
    capture_content: bool


@dataclass(frozen=True, slots=True)
class ExternalTraceDelivery:
    id: str
    tenant_id: str
    invocation_id: str
    provider: str
    encrypted_config: Mapping[str, Any]
    trace_payload: Mapping[str, Any]
    lease_token: str


@dataclass(frozen=True, slots=True)
class ExternalTraceDeliveryStatus:
    id: str
    target_kind: str
    target_id: str
    provider: str
    config_revision: str
    payload_revision: int
    state: str
    attempts: int
    error_code: str | None
    trace_url: str | None


class ExternalTracingStore(Protocol):
    def configured_provider_states(
        self, context: RequestContext, *, agent_id: str
    ) -> Sequence[ExternalTracingProviderState]:
        """Read all configured summaries in one owner-scoped query, never config values.

        Recheck owner/admin membership and live asset ownership. Return stable
        provider ordering; no decrypted/encrypted secrets cross this port.
        """
        ...

    def config(self, *, tenant_id: str, agent_id: str, provider: str) -> StoredExternalTracingConfig | None: ...

    def save_config(
        self,
        *,
        context: RequestContext,
        agent_id: str,
        provider: str,
        encrypted_config: Mapping[str, Any],
        enabled: bool,
        capture_content: bool,
        expected_revision: int,
        now: datetime,
    ) -> StoredExternalTracingConfig:
        """Recheck membership/asset and CAS expected revision in one locked transaction."""
        ...

    def delete_config(self, *, context: RequestContext, agent_id: str, provider: str, expected_revision: int) -> None:
        """Delete configuration under the same membership/owner/version checks."""
        ...

    def freeze_targets(
        self, *, tenant_id: str, invocation_id: str, now: datetime
    ) -> Sequence[FrozenExternalTraceTarget]:
        """Freeze target policies once before dispatch under the Invocation lock.

        Existing snapshots win over later current config. Source App content and
        target content are intersected; no global deployment fallback is used.
        """
        ...

    def export_source(
        self, *, tenant_id: str, invocation_id: str, now: datetime
    ) -> tuple[InvocationObservationOwner, TraceSnapshot, Sequence[FrozenExternalTraceTarget]]: ...

    def enqueue_delivery(
        self, *, target: FrozenExternalTraceTarget, payload_revision: int, trace: Trace, now: datetime
    ) -> str:
        """Persist idempotent intent and frozen payload, rechecking parent fences."""
        ...

    def existing_delivery_id(self, *, target: FrozenExternalTraceTarget, payload_revision: int) -> str | None:
        """Keep an already frozen target payload unchanged when reconciling its source."""
        ...

    def pending_export_sources(self, *, now: datetime, limit: int) -> Sequence[tuple[str, str]]:
        """Find retained terminal sources missing a current-revision target intent."""
        ...

    def claim_delivery(self, *, tenant_id: str, delivery_id: str, now: datetime) -> ExternalTraceDelivery | None:
        """Fence one bounded export lease; expired unconfirmed leases become uncertain."""
        ...

    def finish_delivery(
        self,
        *,
        delivery: ExternalTraceDelivery,
        state: str,
        error_code: str | None,
        result: SendResult | None,
        now: datetime,
    ) -> None:
        """Update only the matching lease; parent deletion always wins."""
        ...

    def pending_deliveries(self, *, now: datetime, limit: int) -> Sequence[tuple[str, str]]: ...

    def claim_publishable_deliveries(self, *, now: datetime, limit: int) -> Sequence[tuple[str, str]]:
        """Lease broker publication independently of pending->exporting I/O claims."""
        ...

    def delivery_statuses(self, *, tenant_id: str, invocation_id: str) -> Sequence[ExternalTraceDeliveryStatus]: ...

    def retry_delivery(
        self,
        *,
        tenant_id: str,
        invocation_id: str,
        delivery_id: str,
        acknowledge_possible_duplicates: bool,
        now: datetime,
    ) -> None:
        """Requeue the same frozen payload; uncertain delivery requires explicit acknowledgement."""
        ...


class ExternalTraceSender(Protocol):
    def send(
        self, *, tenant_id: str, provider: str, encrypted_config: Mapping[str, Any], trace_payload: Mapping[str, Any]
    ) -> SendResult:
        """Use existing provider catalog, workspace codec and SSRF egress."""
        ...


class TraceExportPreflightError(Exception):
    """Known failure before any provider send; its payload is never public."""


class ExternalTracingProviderGateway(Protocol):
    """SDK presentation contract; the dev Native gateway retains its legacy dict result."""

    def validate_provider(self, tracing_provider: str) -> None: ...

    def validate_saved_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any]
    ) -> None: ...

    def prepare_new_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any]
    ) -> dict[str, Any]: ...

    def prepare_updated_config(
        self,
        *,
        workspace_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
        current_tracing_config: dict[str, Any] | None,
    ) -> dict[str, Any]: ...

    def present_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any] | None
    ) -> PresentedTracingConfig: ...


class ExternalTracingConfigService:
    def __init__(
        self,
        *,
        store: ExternalTracingStore,
        access: ExternalObservationAccess,
        provider: ExternalTracingProviderGateway,
    ) -> None:
        self._store, self._access, self._provider = store, access, provider

    def overview(self, context: RequestContext, agent_id: str) -> ExternalTracingProviderOverview:
        """Read configured destinations and the enabled provider without config I/O.

        Only a live asset's owner/admin may read. No provider discovery,
        verification or secret presentation is performed; corrupt multiple-active
        state fails explicitly instead of inventing a selected destination.
        """
        self._access.manage(context, agent_id)
        providers = tuple(self._store.configured_provider_states(context, agent_id=agent_id))
        enabled = tuple(value.provider for value in providers if value.enabled)
        if len(enabled) > 1:
            raise ObservationConflictError("tracing_provider_state_conflict")
        return ExternalTracingProviderOverview(enabled[0] if enabled else None, providers)

    def get(self, context: RequestContext, agent_id: str, provider: str) -> ExternalTracingConfiguration | None:
        """Present a live asset target without decrypting or returning secret values."""
        self._access.manage(context, agent_id)
        self._provider.validate_provider(provider)
        stored = self._store.config(tenant_id=context.active_workspace_id, agent_id=agent_id, provider=provider)
        if stored is None:
            return None
        presented = self._provider.present_config(
            workspace_id=context.active_workspace_id,
            tracing_provider=provider,
            tracing_config=dict(stored.encrypted_config),
        )
        return ExternalTracingConfiguration(
            provider,
            stored.revision,
            stored.enabled,
            stored.capture_content,
            presented.values,
            presented.configured_secrets,
        )

    def save(
        self,
        context: RequestContext,
        agent_id: str,
        *,
        provider: str,
        config: Mapping[str, Any],
        enabled: bool,
        capture_content: bool,
        expected_revision: int,
        now: datetime,
    ) -> ExternalTracingConfiguration:
        """Verify outside transactions, then atomically save against the original revision."""
        self._access.manage(context, agent_id)
        self._provider.validate_provider(provider)
        current = self._store.config(tenant_id=context.active_workspace_id, agent_id=agent_id, provider=provider)
        if (current.revision if current else 0) != expected_revision:
            raise ObservationConflictError("tracing_config_changed")
        encrypted = self._provider.prepare_updated_config(
            workspace_id=context.active_workspace_id,
            tracing_provider=provider,
            tracing_config=dict(config),
            current_tracing_config=dict(current.encrypted_config) if current else None,
        )
        self._store.save_config(
            context=context,
            agent_id=agent_id,
            provider=provider,
            encrypted_config=encrypted,
            enabled=enabled,
            capture_content=capture_content,
            expected_revision=expected_revision,
            now=now,
        )
        result = self.get(context, agent_id, provider)
        if result is None:
            raise ObservationConflictError("tracing_config_changed")
        return result

    def delete(self, context: RequestContext, agent_id: str, provider: str, expected_revision: int) -> None:
        """Remove current configuration; already-frozen deliveries retain their own snapshot."""
        self._access.manage(context, agent_id)
        self._provider.validate_provider(provider)
        self._store.delete_config(
            context=context, agent_id=agent_id, provider=provider, expected_revision=expected_revision
        )


def build_external_trace(
    owner: InvocationObservationOwner, snapshot: TraceSnapshot, target: FrozenExternalTraceTarget
) -> Trace | None:
    """Build only truthful canonical spans under the known local Invocation.

    Missing remote time/status stays in Console rather than being fabricated for
    a provider's mandatory fields. Total-only tokens remain metadata, not invented
    input/output token splits. Source content can only be further reduced here.
    """
    if owner.started_at is None or owner.ended_at is None or owner.ended_at < owner.started_at:
        return None
    root_id = span_id_for(f"external:{owner.id}")
    # The wrapper describes the local wait, not a claim that every remote step succeeded.
    status = SpanStatus.OK if owner.local_state in {"succeeded", "completed", "success"} else SpanStatus.ERROR
    attributes: dict[str, Any] = {
        "dify.external.invocation_id": owner.id,
        "dify.external.agent_id": owner.agent_id,
        "dify.tenant_id": owner.tenant_id,
        "dify.app_id": owner.app_id,
        "dify.external.local_state": owner.local_state,
        "dify.external.remote_state": owner.remote_state,
        "dify.external.received_steps": len(snapshot.steps),
        "a2a.reported_call_total_tokens": snapshot.call_total_tokens,
        "dify.external.usage_revision": snapshot.usage_revision,
    }
    spans = [
        Span(
            span_id=root_id,
            parent_span_id=None,
            name="External Agent invocation",
            kind=SpanKind.AGENT,
            start_time=aware_utc(owner.started_at),
            end_time=aware_utc(owner.ended_at),
            status=status,
            attributes=attributes,
        )
    ]
    admitted: set[str] = {root_id}
    pending = list(snapshot.steps)
    while pending:
        ready = [
            step
            for step in pending
            if step.resolved_parent_key is None
            or span_id_for(f"external:{owner.id}:{step.resolved_parent_key}") in admitted
        ]
        if not ready:
            pending = []
        else:
            for step in ready:
                started_at, ended_at = step.started_at, step.ended_at
                known_status = step.status in {"ok", "success", "succeeded", "completed", "error", "failed"}
                if (
                    started_at is not None
                    and ended_at is not None
                    and ended_at >= started_at
                    and step.name
                    and step.kind in {"agent", "tool"}
                    and (known_status or step.error)
                ):
                    identifier = span_id_for(f"external:{owner.id}:{step.key}")
                    parent = (
                        span_id_for(f"external:{owner.id}:{step.resolved_parent_key}")
                        if step.resolved_parent_key
                        else root_id
                    )
                    step_attributes = {
                        "a2a.trace_id": step.trace_id,
                        "a2a.step_id": step.step_id,
                        "a2a.parent_step_id": step.parent_step_id,
                        "a2a.reported_total_tokens": step.total_tokens,
                    }
                    spans.append(
                        Span(
                            span_id=identifier,
                            parent_span_id=parent,
                            name=step.name,
                            kind=SpanKind.TOOL if step.kind == "tool" else SpanKind.AGENT,
                            start_time=aware_utc(started_at),
                            end_time=aware_utc(ended_at),
                            status=SpanStatus.ERROR
                            if step.error or step.status in {"error", "failed"}
                            else SpanStatus.OK,
                            error=step.error if target.capture_content else None,
                            attributes=step_attributes,
                            inputs=dict(step.raw_data) if target.capture_content else None,
                        )
                    )
                    admitted.add(identifier)
            consumed = {step.key for step in ready}
            pending = [step for step in pending if step.key not in consumed]
    digest = hashlib.sha256(f"external:{owner.id}:{target.kind}:{target.owner_id}".encode()).hexdigest()
    return Trace(
        trace_id=trace_id_for(digest),
        external_trace_id=None,
        session_id=owner.id,
        user_id=None,
        parent=None,
        spans=tuple(spans),
    )


class ExternalTraceDeliveryService:
    def __init__(
        self,
        *,
        store: ExternalTracingStore,
        sender: ExternalTraceSender,
        access: ExternalObservationAccess,
        clock: Callable[[], datetime],
    ) -> None:
        self._store, self._sender = store, sender
        self._access = access
        self._clock = clock

    def freeze(self, *, tenant_id: str, invocation_id: str, now: datetime) -> None:
        """Freeze destinations before dispatch; repeated reservations reuse original snapshots."""
        self._store.freeze_targets(tenant_id=tenant_id, invocation_id=invocation_id, now=now)

    def enqueue(self, *, tenant_id: str, invocation_id: str, now: datetime) -> tuple[str, ...]:
        """Freeze a separate payload per target/revision, without sending in the request."""
        owner, snapshot, targets = self._store.export_source(tenant_id=tenant_id, invocation_id=invocation_id, now=now)
        deliveries: list[str] = []
        for target in targets:
            existing = self._store.existing_delivery_id(target=target, payload_revision=snapshot.revision)
            if existing is not None:
                deliveries.append(existing)
            else:
                trace = build_external_trace(owner, snapshot, target)
                if trace is not None:
                    deliveries.append(
                        self._store.enqueue_delivery(
                            target=target, payload_revision=snapshot.revision, trace=trace, now=now
                        )
                    )
        return tuple(deliveries)

    def reconcile_sources(self, *, now: datetime, limit: int = 100) -> int:
        """Close the observe-before-terminal-commit crash gap without provider I/O.

        Every enqueue rechecks its source fence. Concurrent scanners converge on
        the same target/revision delivery key; an existing immutable payload is
        retained even when another destination still needs materialization.
        """
        sources = self._store.pending_export_sources(now=now, limit=limit)
        prepared = 0
        for tenant_id, invocation_id in sources:
            try:
                self.enqueue(tenant_id=tenant_id, invocation_id=invocation_id, now=now)
                prepared += 1
            except (ObservationExpiredError, ObservationNotFoundError):
                # Parent deletion/retention can win after the candidate read.
                pass
        return prepared

    def deliver(self, *, tenant_id: str, delivery_id: str, now: datetime) -> None:
        """Deliver one fenced snapshot; exporter retries can never dispatch business work."""
        delivery = self._store.claim_delivery(tenant_id=tenant_id, delivery_id=delivery_id, now=now)
        if delivery is not None:
            try:
                result = self._sender.send(
                    tenant_id=delivery.tenant_id,
                    provider=delivery.provider,
                    encrypted_config=delivery.encrypted_config,
                    trace_payload=delivery.trace_payload,
                )
            except ExportOutcomeUnknownError:
                self._store.finish_delivery(
                    delivery=delivery,
                    state="uncertain",
                    error_code="provider_outcome_unknown",
                    result=None,
                    now=self._clock(),
                )
            except ExportRetryableError:
                self._store.finish_delivery(
                    delivery=delivery, state="retrying", error_code="provider_retryable", result=None, now=self._clock()
                )
            except ExportRejectedError:
                self._store.finish_delivery(
                    delivery=delivery, state="failed", error_code="provider_rejected", result=None, now=self._clock()
                )
            except TraceExportPreflightError:
                self._store.finish_delivery(
                    delivery=delivery, state="failed", error_code="provider_unavailable", result=None, now=self._clock()
                )
            except Exception:
                # Unclassified failures can contain credentials; never expose their text.
                self._store.finish_delivery(
                    delivery=delivery,
                    state="uncertain",
                    error_code="provider_outcome_unknown",
                    result=None,
                    now=self._clock(),
                )
            else:
                self._store.finish_delivery(
                    delivery=delivery, state="accepted", error_code=None, result=result, now=self._clock()
                )

    def reconcile(self, *, now: datetime, limit: int = 100) -> int:
        """Drain durable due intents after broker/worker recovery, under store leases."""
        pending = self._store.pending_deliveries(now=now, limit=limit)
        for tenant_id, delivery_id in pending:
            self.deliver(tenant_id=tenant_id, delivery_id=delivery_id, now=now)
        return len(pending)

    def claim_publishable_deliveries(self, *, now: datetime, limit: int = 100) -> tuple[tuple[str, str], ...]:
        """Lease due intents for the existing isolated tracing queue, without network I/O."""
        return tuple(self._store.claim_publishable_deliveries(now=now, limit=limit))

    def statuses(
        self, context: RequestContext, invocation_id: str, *, now: datetime
    ) -> tuple[ExternalTraceDeliveryStatus, ...]:
        """Read target-independent acknowledgements under the source record permission."""
        owner, _, _ = self._store.export_source(
            tenant_id=context.active_workspace_id, invocation_id=invocation_id, now=now
        )
        self._access.trace_read(context, owner)
        return tuple(self._store.delivery_statuses(tenant_id=context.active_workspace_id, invocation_id=invocation_id))

    def retry(
        self,
        context: RequestContext,
        invocation_id: str,
        delivery_id: str,
        *,
        acknowledge_possible_duplicates: bool,
        now: datetime,
    ) -> None:
        """Explicitly retry one delivery; no business-dispatch port is reachable here."""
        owner, _, _ = self._store.export_source(
            tenant_id=context.active_workspace_id, invocation_id=invocation_id, now=now
        )
        self._access.trace_read(context, owner)
        self._access.manage(context, owner.agent_id)
        self._store.retry_delivery(
            tenant_id=context.active_workspace_id,
            invocation_id=invocation_id,
            delivery_id=delivery_id,
            acknowledge_possible_duplicates=acknowledge_possible_duplicates,
            now=now,
        )
