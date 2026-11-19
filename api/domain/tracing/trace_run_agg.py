"""The Agent trace run aggregate.

A run is the trace of one Agent-managed execution: the destination and capture
policy frozen when the execution started, the runtime invocations that report
spans into it, its business terminal, and its export lifecycle. Callers pass
the time, generated identifiers, and the facts a rule needs.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID, uuid5

from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceSpan
from dify_trace_sdk.ids import span_id_for
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace

from domain.tracing.errors import TraceRunConflictError, TraceRunError, TraceRunLimitError, TraceRunNotFoundError
from domain.tracing.normalization import (
    legacy_outer_trace,
    normalize_agent_span,
    order_spans,
    remap_outer_trace,
    safe_attributes,
    sanitize,
)
from domain.tracing.sources import SourceNodeExecution

type TraceSourceKind = Literal["message", "workflow", "node"]


class TraceRunState(StrEnum):
    NOT_COLLECTED = "not_collected"
    """The app did not trace when the execution started; nothing is collected or exported."""
    COLLECTING = "collecting"
    READY = "ready"
    """Released by a manual retry; exported once its collection is complete."""
    EXPORTING = "exporting"
    RETRYING = "retrying"
    ACCEPTED = "accepted"
    FAILED = "failed"
    UNCERTAIN = "uncertain"
    """The destination may have accepted the trace; only an acknowledged retry sends it again."""

    @property
    def accepts_terminal(self) -> bool:
        """A run that collects nothing or is closed keeps no business terminal."""
        return self in {TraceRunState.COLLECTING, TraceRunState.READY, TraceRunState.RETRYING}


# A closed run accepts no runtime batches and no other business terminal.
_CLOSED_STATES = frozenset(
    {TraceRunState.ACCEPTED, TraceRunState.EXPORTING, TraceRunState.UNCERTAIN, TraceRunState.FAILED}
)
_COLLECTING_STATES = frozenset({TraceRunState.COLLECTING, TraceRunState.READY})
_SETTLED_STATES = frozenset(
    {TraceRunState.NOT_COLLECTED, TraceRunState.ACCEPTED, TraceRunState.FAILED, TraceRunState.UNCERTAIN}
)
_UNFINISHED_NODE_STATUSES = frozenset({"running", "pending", "paused"})
_SESSION_ID_CHARS = 255


@dataclass(frozen=True, slots=True)
class TraceInvocation:
    """One Agent runtime invocation that reports spans into a run."""

    id: str
    run_id: str
    agent_id: str
    parent_span_id: str
    span_id: str
    node_execution_id: str | None
    """``None`` for the invocation of an Agent app."""
    attempt: int
    finalized: bool
    finalized_at: datetime | None
    """``None`` until the runtime reports the invocation's final batch."""


@dataclass(frozen=True, slots=True)
class TraceBatchReceipt:
    """What a run remembers of a stored batch to recognize its replays."""

    id: str
    invocation_id: str
    payload_hash: str
    """The SHA-256 of the batch's original payload."""


@dataclass(frozen=True, slots=True)
class TraceBatch:
    """A runtime batch as a run stores it; its spans already follow the run's capture policy."""

    id: str
    invocation_id: str
    payload_hash: str
    spans: Sequence[Mapping[str, Any]]
    final: bool


@dataclass(kw_only=True, eq=False, slots=True)
class TraceRunAgg:
    """An Agent trace run, its invocations, and the receipts of its stored batches.

    State changes only through the methods below. ``invocations`` keeps them by
    attempt, then creation. ``new_batches`` holds the batches ingested since the
    run was loaded, for the repository to store.
    """

    id: str
    tenant_id: str
    app_id: str
    source_kind: TraceSourceKind
    source_id: str
    provider: str
    """``""`` when the run froze no destination."""
    config_revision: str
    """``""`` when the run froze no destination."""
    provider_config: Mapping[str, Any]
    """The frozen stored configuration, secrets still encrypted."""
    trace_id: str
    root_span_id: str
    session_id: str
    capture_content: bool
    capture_agent: bool
    state: TraceRunState
    outer_trace: Mapping[str, Any] | None
    """The captured business terminal; ``None`` until it is captured."""
    span_count: int
    payload_bytes: int
    attempts: int
    error_code: str | None
    """``None`` unless the run failed, waits for a retry, or its export outcome is uncertain."""
    trace_url: str | None
    provider_trace_id: str | None
    span_urls: Mapping[str, str]
    export_token: str | None
    """The token fencing the current export attempt; ``None`` when no attempt holds the run."""
    export_started_at: datetime | None
    export_heartbeat_at: datetime | None
    """``None`` for attempts started before heartbeats were recorded."""
    next_attempt_at: datetime | None
    """``None`` unless a retryable export failure waits for its backoff."""
    accepted_at: datetime | None
    terminal_at: datetime | None
    """When the business terminal was captured; ``None`` until then."""
    updated_at: datetime
    invocations: dict[str, TraceInvocation]
    receipts: dict[str, TraceBatchReceipt]
    new_batches: list[TraceBatch] = field(default_factory=list, init=False)

    @classmethod
    def freeze(
        cls,
        *,
        run_id: str,
        trace_id: str,
        tenant_id: str,
        app_id: str,
        source_kind: TraceSourceKind,
        source_id: str,
        session_id: str,
        policy: Mapping[str, Any],
        stored_config: Mapping[str, Any] | None,
        now: datetime,
    ) -> "TraceRunAgg":
        """Freeze the app's destination and capture policy for a source.

        A run collects only when the policy enables the provider it names and
        that provider has a stored configuration; otherwise it is frozen as not
        collected. The revision identifies the frozen policy and configuration.
        """
        named = policy.get("tracing_provider")
        destination = (
            (named, dict(stored_config))
            if isinstance(named, str) and policy.get("enabled") is True and stored_config is not None
            else None
        )
        provider, frozen = destination if destination is not None else ("", {})
        collecting = destination is not None
        revision = hashlib.sha256(
            json.dumps({"config": frozen, "policy": dict(policy)}, sort_keys=True, default=str).encode()
        ).hexdigest()
        return cls._new(
            run_id=run_id,
            trace_id=trace_id,
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            provider=provider,
            config_revision=revision,
            provider_config=frozen,
            session_id=session_id[:_SESSION_ID_CHARS] or source_id,
            capture_content=collecting and policy.get("capture_content", False) is True,
            capture_agent=collecting and policy.get("capture_agent", True) is True,
            state=TraceRunState.COLLECTING if collecting else TraceRunState.NOT_COLLECTED,
            error_code=None,
            terminal_at=None,
            now=now,
        )

    @classmethod
    def initialization_failed(
        cls,
        *,
        run_id: str,
        trace_id: str,
        tenant_id: str,
        app_id: str,
        source_kind: TraceSourceKind,
        source_id: str,
        now: datetime,
    ) -> "TraceRunAgg":
        """Close a source whose start snapshot is missing.

        It must never fall back to an exporter without its capture policy.
        """
        return cls._new(
            run_id=run_id,
            trace_id=trace_id,
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            provider="",
            config_revision="",
            provider_config={},
            session_id=source_id,
            capture_content=False,
            capture_agent=False,
            state=TraceRunState.FAILED,
            error_code="tracing_initialization_failed",
            terminal_at=now,
            now=now,
        )

    @classmethod
    def _new(
        cls,
        *,
        run_id: str,
        trace_id: str,
        tenant_id: str,
        app_id: str,
        source_kind: TraceSourceKind,
        source_id: str,
        provider: str,
        config_revision: str,
        provider_config: Mapping[str, Any],
        session_id: str,
        capture_content: bool,
        capture_agent: bool,
        state: TraceRunState,
        error_code: str | None,
        terminal_at: datetime | None,
        now: datetime,
    ) -> "TraceRunAgg":
        return cls(
            id=run_id,
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            provider=provider,
            config_revision=config_revision,
            provider_config=provider_config,
            trace_id=trace_id,
            root_span_id=span_id_for(source_id),
            session_id=session_id,
            capture_content=capture_content,
            capture_agent=capture_agent,
            state=state,
            outer_trace=None,
            span_count=0,
            payload_bytes=0,
            attempts=0,
            error_code=error_code,
            trace_url=None,
            provider_trace_id=None,
            span_urls={},
            export_token=None,
            export_started_at=None,
            export_heartbeat_at=None,
            next_attempt_at=None,
            accepted_at=None,
            terminal_at=terminal_at,
            updated_at=now,
            invocations={},
            receipts={},
        )

    @property
    def awaits_terminal(self) -> bool:
        """The run collects and has not captured its business terminal yet."""
        return self.outer_trace is None and self.state in _COLLECTING_STATES

    def open_invocation(
        self, *, agent_id: str, node_execution_id: str | None, attempt: int, call_key: str
    ) -> TraceInvocation:
        """Create the invocation of a call key once; a repeated call key must name the same Agent binding.

        Raises:
            TraceRunConflictError: The run stopped collecting, or the call key names another invocation.
        """
        if self.state not in _COLLECTING_STATES:
            raise TraceRunConflictError("tracing_run_not_collecting")
        identifier = str(uuid5(UUID(self.id), call_key))
        current = self.invocations.get(identifier)
        if current is not None:
            if (current.agent_id, current.node_execution_id, current.attempt) != (agent_id, node_execution_id, attempt):
                raise TraceRunConflictError("tracing_invocation_conflict")
            return current
        invocation = TraceInvocation(
            id=identifier,
            run_id=self.id,
            agent_id=agent_id,
            parent_span_id=span_id_for(node_execution_id) if node_execution_id else self.root_span_id,
            span_id=span_id_for(f"agent-attempt:{identifier}"),
            node_execution_id=node_execution_id,
            attempt=attempt,
            finalized=False,
            finalized_at=None,
        )
        self.invocations[identifier] = invocation
        return invocation

    def ingest(self, batch: AgentTraceBatch, *, max_spans: int, max_bytes: int, now: datetime) -> int:
        """Append a runtime batch and return its span count; a final batch finalizes its invocation.

        A batch ID replays only with the same validated payload, even after the run closed.

        Raises:
            TraceRunNotFoundError: The batch's invocation is not one of this run's.
            TraceRunConflictError: The batch conflicts with a stored one, or the run or invocation stopped collecting.
            TraceRunLimitError: The batch exceeds the run's limits.
        """
        # Hash the original validated payload. Sanitization cannot turn two
        # conflicting producer payloads into a falsely successful replay.
        canonical = json.dumps(batch.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(canonical).hexdigest()
        invocation = self.invocations.get(str(batch.invocation_id))
        if invocation is None:
            raise TraceRunNotFoundError("tracing_invocation_not_found")
        batch_id = str(batch.batch_id)
        spans = batch.spans
        previous = self.receipts.get(batch_id)
        if previous is not None:
            if previous.invocation_id != invocation.id or previous.payload_hash != digest:
                raise TraceRunConflictError("tracing_batch_conflict")
            return len(spans)
        if self.state in _CLOSED_STATES or invocation.finalized:
            raise TraceRunConflictError("tracing_collection_closed")
        if any(span.trace_id != self.trace_id for span in spans):
            raise TraceRunConflictError("tracing_trace_id_mismatch")
        if self.span_count + len(spans) > max_spans or self.payload_bytes + len(canonical) > max_bytes:
            raise TraceRunLimitError("tracing_payload_limit")
        final = batch.final
        self.new_batches.append(
            TraceBatch(
                id=batch_id,
                invocation_id=invocation.id,
                payload_hash=digest,
                spans=[self._stored_span(span) for span in spans],
                final=final,
            )
        )
        self.receipts[batch_id] = TraceBatchReceipt(id=batch_id, invocation_id=invocation.id, payload_hash=digest)
        self.span_count += len(spans)
        self.payload_bytes += len(canonical)
        self.updated_at = now
        if final:
            self.invocations[invocation.id] = replace(invocation, finalized=True, finalized_at=now)
        return len(spans)

    def _stored_span(self, span: AgentTraceSpan) -> dict[str, Any]:
        stored = span.model_dump(mode="json")
        stored["attributes"] = safe_attributes(span.attributes, capture_content=self.capture_content)
        if not self.capture_content:
            stored["events"] = []
            stored["status_message"] = "Agent operation failed" if span.status == "error" else None
        return stored

    def capture_terminal(self, trace: Trace, *, now: datetime) -> None:
        """Keep the execution's business terminal under the run's trace ID, session, and capture policy.

        The Agent runtime reports a message's LLM work itself, so the
        terminal's own LLM span is dropped.
        """
        synthetic = frozenset({span_id_for(f"{self.source_id}:llm")}) if self.source_kind == "message" else frozenset()
        adopted = remap_outer_trace(
            trace, trace_id=self.trace_id, capture_content=self.capture_content, synthetic_span_ids=synthetic
        )
        self._keep_terminal(adopted.model_copy(update={"session_id": self.session_id}), now=now)

    def settle_preview(self, node: SourceNodeExecution, *, now: datetime) -> None:
        """Make a finished single-node preview its own terminal; a preview reports no business terminal."""
        if self.source_kind != "node" or self.outer_trace is not None or node.status in _UNFINISHED_NODE_STATUSES:
            return
        error = node.error
        started_at = node.created_at.replace(tzinfo=UTC)
        span = Span(
            span_id=self.root_span_id,
            parent_span_id=None,
            name=node.title or "Agent preview",
            kind=SpanKind.AGENT,
            start_time=started_at,
            end_time=started_at + timedelta(seconds=node.elapsed_time or 0),
            status=SpanStatus.ERROR if error else SpanStatus.OK,
            error=error if self.capture_content else "Node execution failed" if error else None,
            inputs=sanitize(node.inputs) if self.capture_content else None,
            outputs=sanitize(node.outputs) if self.capture_content else None,
            attributes={"node_execution_id": node.id, "node_id": node.node_id, "source": "single_step"},
        )
        trace = Trace(
            trace_id=self.trace_id,
            external_trace_id=None,
            session_id=self.session_id,
            user_id=None,
            parent=None,
            spans=(span,),
        )
        self._keep_terminal(trace, now=now)

    def _keep_terminal(self, trace: Trace, *, now: datetime) -> None:
        if not self.state.accepts_terminal:
            return
        stored = trace.model_dump(mode="json")
        if self.outer_trace is not None and self.outer_trace != stored:
            # A duplicate terminal task must not rewrite a completed immutable
            # span. The first persisted terminal envelope owns the export.
            return
        self.outer_trace = stored
        self.root_span_id = trace.root.span_id
        self.terminal_at = self.terminal_at or now
        self.updated_at = now

    def recovery_checked(self, error_code: str | None, *, now: datetime) -> None:
        """Rotate incomplete work behind other pending runs, or fail it with ``error_code``.

        A run that captured its terminal or left collection is not changed.
        """
        if not self.awaits_terminal:
            return
        self.updated_at = now
        if error_code is not None:
            self.state, self.error_code = TraceRunState.FAILED, error_code

    def claim_export(
        self, *, token: str, owner_exists: bool, collection_timeout: int, lease_seconds: int, now: datetime
    ) -> bool:
        """Lease a complete run for one export attempt that ``token`` fences; ``False`` when it is not exportable now.

        A run is complete once its terminal is captured and every invocation is
        finalized; ``collection_timeout`` seconds after the terminal an
        incomplete run fails. An export whose last heartbeat is older than
        ``lease_seconds`` becomes uncertain, and a run whose app is gone fails.
        """
        if self.state in _SETTLED_STATES:
            return False
        if self.state is TraceRunState.EXPORTING:
            last_heartbeat = self.export_heartbeat_at or self.export_started_at
            if last_heartbeat and last_heartbeat + timedelta(seconds=lease_seconds) < now:
                self.state, self.error_code = TraceRunState.UNCERTAIN, "export_lease_expired"
                self.updated_at = now
            return False
        if self.outer_trace is None:
            return False
        if any(not invocation.finalized for invocation in self.invocations.values()):
            if self.terminal_at and self.terminal_at + timedelta(seconds=collection_timeout) < now:
                self.state, self.error_code = TraceRunState.FAILED, "agent_trace_collection_incomplete"
                self.updated_at = now
            return False
        if self.next_attempt_at and self.next_attempt_at > now:
            return False
        if not owner_exists:
            self.state, self.error_code = TraceRunState.FAILED, "tracing_owner_not_found"
            return False
        self.state, self.export_token = TraceRunState.EXPORTING, token
        self.export_started_at = self.export_heartbeat_at = self.updated_at = now
        self.attempts += 1
        return True

    def renew_export_lease(self, token: str, *, now: datetime) -> bool:
        """Renew only the current export attempt; ``False`` once the attempt no longer holds the run."""
        if self.state is not TraceRunState.EXPORTING or self.export_token != token:
            return False
        self.export_heartbeat_at = self.updated_at = now
        return True

    def export_accepted(
        self,
        token: str,
        *,
        provider_trace_id: str,
        trace_url: str | None,
        span_urls: Mapping[str, str],
        now: datetime,
    ) -> None:
        """Record the destination's acceptance.

        An acceptance that arrives after its lease expired still records the
        destination's result, unless a manual retry replaced its token.
        """
        late = self.state is TraceRunState.UNCERTAIN and self.error_code == "export_lease_expired"
        if self.export_token != token or (self.state is not TraceRunState.EXPORTING and not late):
            return
        self._finish_export(TraceRunState.ACCEPTED, None, now=now)
        self.provider_trace_id, self.trace_url, self.span_urls = provider_trace_id, trace_url, dict(span_urls)
        self.accepted_at = now

    def export_deferred(self, token: str, *, max_attempts: int, now: datetime) -> None:
        """Wait with exponential backoff after a retryable failure until the attempts run out."""
        if self.attempts >= max_attempts:
            self.export_failed(token, "provider_retry_exhausted", now=now)
            return
        if not self._holds_export(token):
            return
        self._finish_export(TraceRunState.RETRYING, "provider_temporarily_unavailable", now=now)
        self.next_attempt_at = now + timedelta(seconds=min(300, 5 * 2 ** min(self.attempts - 1, 6)))

    def export_uncertain(self, token: str, *, now: datetime) -> None:
        """The destination may have accepted the trace; only an acknowledged retry sends it again."""
        if self._holds_export(token):
            self._finish_export(TraceRunState.UNCERTAIN, "provider_acceptance_unknown", now=now)

    def export_failed(self, token: str, error_code: str, *, now: datetime) -> None:
        if self._holds_export(token):
            self._finish_export(TraceRunState.FAILED, error_code, now=now)

    def _holds_export(self, token: str) -> bool:
        return self.state is TraceRunState.EXPORTING and self.export_token == token

    def _finish_export(self, state: TraceRunState, error_code: str | None, *, now: datetime) -> None:
        self.state, self.error_code = state, error_code
        self.export_token = None
        self.next_attempt_at = None
        self.updated_at = now

    def release_for_retry(self, *, acknowledge_possible_duplicates: bool, now: datetime) -> None:
        """Release a failed or uncertain run for another export.

        Raises:
            TraceRunNotFoundError: Nothing was collected.
            TraceRunConflictError: The run is accepted, not retryable, or needs the duplicate acknowledgement.
        """
        if self.state is TraceRunState.NOT_COLLECTED:
            raise TraceRunNotFoundError("tracing_run_not_found")
        if self.state is TraceRunState.ACCEPTED:
            raise TraceRunConflictError("tracing_already_accepted")
        if self.state not in {TraceRunState.FAILED, TraceRunState.UNCERTAIN} or self.outer_trace is None:
            raise TraceRunConflictError("tracing_retry_not_allowed")
        if any(not invocation.finalized for invocation in self.invocations.values()) or (
            self.error_code or ""
        ).startswith("tracing_"):
            raise TraceRunConflictError("tracing_retry_not_allowed")
        if self.state is TraceRunState.UNCERTAIN and not acknowledge_possible_duplicates:
            raise TraceRunConflictError("tracing_duplicate_acknowledgement_required")
        self.state, self.error_code, self.export_token = TraceRunState.READY, None, None
        self.next_attempt_at = None
        self.updated_at = now

    def exported_trace(self, batches: Sequence[TraceBatch]) -> Trace:
        """The trace this run exports: its business terminal with each invocation's spans under an Agent span.

        ``batches`` are the run's stored batches by arrival.

        Raises:
            TraceRunError: The stored tree is not valid, so no export can repair it.
            ValueError: A stored span is malformed.
        """
        if self.outer_trace is None:
            raise TraceRunError("tracing_terminal_missing")
        # Runs captured before the upgrade stored the previous trace shape, named by its root span.
        stored = self.outer_trace
        outer = legacy_outer_trace(stored) if "root_span_id" in stored else Trace.model_validate(stored)
        spans = list(outer.spans)
        internal_by_invocation: dict[str, dict[str, Span]] = {invocation_id: {} for invocation_id in self.invocations}
        for batch in batches:
            if batch.invocation_id not in self.invocations:
                raise TraceRunError("tracing_invocation_not_found")
            for data in batch.spans:
                span = normalize_agent_span(data, capture_content=self.capture_content)
                current = internal_by_invocation[batch.invocation_id].get(span.span_id)
                if current is not None and current != span:
                    raise TraceRunError("tracing_span_conflict")
                internal_by_invocation[batch.invocation_id][span.span_id] = span
        for invocation in self.invocations.values():
            children = list(internal_by_invocation[invocation.id].values())
            if not children:
                raise TraceRunError("tracing_invocation_empty")
            valid_ids = {child.span_id for child in children}
            if any(
                child.parent_span_id not in valid_ids and child.parent_span_id != invocation.span_id
                for child in children
            ):
                raise TraceRunError("tracing_invocation_parent_invalid")
            root_children = [child for child in children if child.parent_span_id == invocation.span_id]
            if not root_children:
                raise TraceRunError("tracing_invocation_root_missing")
            errors = [child.error for child in root_children if child.status is SpanStatus.ERROR]
            spans.append(
                Span(
                    span_id=invocation.span_id,
                    parent_span_id=invocation.parent_span_id,
                    name=f"Agent attempt {invocation.attempt + 1}",
                    kind=SpanKind.AGENT,
                    start_time=min(child.start_time for child in children),
                    end_time=max(child.end_time for child in children),
                    status=SpanStatus.ERROR if errors else SpanStatus.OK,
                    error=errors[0] if errors else None,
                    attributes={
                        "agent_id": invocation.agent_id,
                        "attempt": invocation.attempt,
                        "node_execution_id": invocation.node_execution_id,
                        "invocation_id": invocation.id,
                    },
                )
            )
            spans.extend(children)
        trusted: dict[str, Any] = {
            "tenant_id": self.tenant_id,
            "app_id": self.app_id,
            "session_id": self.session_id,
            "dify.tenant_id": self.tenant_id,
            "dify.app_id": self.app_id,
            "dify.tracing.run_id": self.id,
            "dify.source.id": self.source_id,
        }
        spans = [span.model_copy(update={"attributes": {**span.attributes, **trusted}}) for span in spans]
        return Trace(
            trace_id=self.trace_id,
            external_trace_id=None,
            session_id=self.session_id,
            user_id=outer.user_id,
            parent=None,
            spans=order_spans(outer.root.span_id, spans),
        )
