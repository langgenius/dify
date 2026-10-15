"""Bounded transactions for application trace collection and delivery leases."""

import hashlib
import json
from datetime import timedelta
from typing import Any, Literal
from uuid import UUID, uuid5

from dify_agent.protocol.tracing import AgentTraceBatch
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.model import App, Message, TraceAppConfig
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from services.tracing.normalization import safe_attributes, span_id


class TraceCollectionError(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        self.code = code
        self.status = status
        super().__init__(code)


class ApplicationTraceRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self.sessions = sessions

    @staticmethod
    def _source(session: Session, *, tenant_id: str, app_id: str, kind: str, source_id: str) -> object | None:
        model = {"message": Message, "workflow": WorkflowRun, "node": WorkflowNodeExecutionModel}[kind]
        return session.scalar(
            select(model)
            .join(App, App.id == model.app_id)
            .where(model.id == source_id, model.app_id == app_id, App.tenant_id == tenant_id)
        )

    def start(
        self,
        *,
        tenant_id: str,
        app_id: str,
        source_kind: Literal["message", "workflow", "node"],
        source_id: str,
        session_id: str,
        workflow_id: str | None = None,
    ) -> ApplicationTraceRun | None:
        # The app row serializes parallel node starts, so one workflow freezes one
        # destination even when its first two Agent nodes start concurrently.
        with self.sessions.begin() as session:
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).with_for_update())
            if app is None:
                return None
            existing = session.scalar(
                select(ApplicationTraceRun).where(
                    ApplicationTraceRun.tenant_id == tenant_id,
                    ApplicationTraceRun.app_id == app_id,
                    ApplicationTraceRun.source_kind == source_kind,
                    ApplicationTraceRun.source_id == source_id,
                )
            )
            if existing is not None:
                return existing
            source = self._source(session, tenant_id=tenant_id, app_id=app_id, kind=source_kind, source_id=source_id)
            if source is None:
                # A single-node preview allocates its execution ID before the
                # node row is saved. Only the trusted workflow builder may reserve
                # it, after checking its persisted owner workflow here.
                if source_kind not in {"node", "workflow"} or workflow_id is None:
                    return None
                workflow = session.scalar(
                    select(Workflow).where(
                        Workflow.id == workflow_id, Workflow.app_id == app_id, Workflow.tenant_id == tenant_id
                    )
                )
                if workflow is None:
                    return None
            try:
                policy = json.loads(app.tracing) if app.tracing else {}
            except (TypeError, ValueError):
                policy = {}
            if not isinstance(policy, dict):
                policy = {}
            provider = policy.get("tracing_provider")
            config = (
                session.scalar(
                    select(TraceAppConfig).where(
                        TraceAppConfig.app_id == app_id,
                        TraceAppConfig.tracing_provider == provider,
                    )
                )
                if isinstance(provider, str) and policy.get("enabled") is True
                else None
            )
            enabled = config is not None and isinstance(config.tracing_config, dict)
            frozen = (
                dict(config.tracing_config) if config is not None and isinstance(config.tracing_config, dict) else {}
            )
            revision = hashlib.sha256(
                json.dumps({"config": frozen, "policy": policy}, sort_keys=True, default=str).encode()
            ).hexdigest()
            record = ApplicationTraceRun(
                id=str(uuidv7()),
                tenant_id=tenant_id,
                app_id=app_id,
                source_kind=source_kind,
                source_id=source_id,
                provider=provider if enabled and isinstance(provider, str) else "",
                config_revision=revision,
                provider_config=frozen,
                trace_id=uuidv7().hex,
                root_span_id=span_id(source_id),
                session_id=session_id[:255] or source_id,
                capture_content=enabled and policy.get("capture_content", False) is True,
                capture_agent=enabled and policy.get("capture_agent", True) is True,
                state="collecting" if enabled else "not_collected",
            )
            session.add(record)
            session.flush()
            return record

    def source_run(
        self, *, tenant_id: str, app_id: str, source_kind: str, source_id: str
    ) -> ApplicationTraceRun | None:
        with self.sessions() as session:
            return session.scalar(
                select(ApplicationTraceRun).where(
                    ApplicationTraceRun.tenant_id == tenant_id,
                    ApplicationTraceRun.app_id == app_id,
                    ApplicationTraceRun.source_kind == source_kind,
                    ApplicationTraceRun.source_id == source_id,
                )
            )

    def record_initialization_failure(
        self,
        *,
        tenant_id: str,
        app_id: str,
        source_kind: str,
        source_id: str,
    ) -> ApplicationTraceRun | None:
        """A missing start snapshot must never fall back to an unmasked exporter."""
        with self.sessions.begin() as session:
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).with_for_update())
            if (
                app is None
                or self._source(session, tenant_id=tenant_id, app_id=app_id, kind=source_kind, source_id=source_id)
                is None
            ):
                return None
            current = session.scalar(
                select(ApplicationTraceRun).where(
                    ApplicationTraceRun.tenant_id == tenant_id,
                    ApplicationTraceRun.app_id == app_id,
                    ApplicationTraceRun.source_kind == source_kind,
                    ApplicationTraceRun.source_id == source_id,
                )
            )
            if current is not None:
                return current
            current = ApplicationTraceRun(
                id=str(uuidv7()),
                tenant_id=tenant_id,
                app_id=app_id,
                source_kind=source_kind,
                source_id=source_id,
                provider="",
                config_revision="",
                provider_config={},
                trace_id=uuidv7().hex,
                root_span_id=span_id(source_id),
                session_id=source_id,
                capture_content=False,
                capture_agent=False,
                state="failed",
                error_code="tracing_initialization_failed",
                terminal_at=naive_utc_now(),
            )
            session.add(current)
            return current

    def invocation(
        self, *, run_id: str, agent_id: str, node_execution_id: str | None, attempt: int, call_key: str
    ) -> ApplicationTraceInvocation:
        identifier = str(uuid5(UUID(run_id), call_key))
        with self.sessions.begin() as session:
            run = session.scalar(select(ApplicationTraceRun).where(ApplicationTraceRun.id == run_id).with_for_update())
            if run is None or run.state not in {"collecting", "ready"}:
                raise TraceCollectionError("tracing_run_not_collecting", 409)
            invocation = session.get(ApplicationTraceInvocation, identifier)
            if invocation is not None and (
                invocation.agent_id != agent_id
                or invocation.node_execution_id != node_execution_id
                or invocation.attempt != attempt
            ):
                raise TraceCollectionError("tracing_invocation_conflict", 409)
            if invocation is None:
                invocation = ApplicationTraceInvocation(
                    id=identifier,
                    run_id=run_id,
                    agent_id=agent_id,
                    parent_span_id=span_id(node_execution_id) if node_execution_id else run.root_span_id,
                    span_id=span_id(f"agent-attempt:{identifier}"),
                    node_execution_id=node_execution_id,
                    attempt=attempt,
                )
                session.add(invocation)
            return invocation

    def ingest(self, batch: AgentTraceBatch, *, max_spans: int, max_bytes: int) -> tuple[int, str]:
        # Hash the original validated payload. Sanitization cannot turn two
        # conflicting producer payloads into a falsely successful replay.
        data = batch.model_dump(mode="json")
        canonical = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(canonical).hexdigest()
        with self.sessions.begin() as session:
            run = session.scalar(
                select(ApplicationTraceRun).where(ApplicationTraceRun.id == str(batch.run_id)).with_for_update()
            )
            if run is None:
                raise TraceCollectionError("tracing_run_not_found", 404)
            app = session.scalar(select(App.id).where(App.id == run.app_id, App.tenant_id == run.tenant_id))
            if app is None:
                raise TraceCollectionError("tracing_owner_not_found", 404)
            invocation = session.scalar(
                select(ApplicationTraceInvocation).where(
                    ApplicationTraceInvocation.id == str(batch.invocation_id),
                    ApplicationTraceInvocation.run_id == run.id,
                )
            )
            if invocation is None:
                raise TraceCollectionError("tracing_invocation_not_found", 404)
            previous = session.get(ApplicationTraceBatch, str(batch.batch_id))
            if previous is not None:
                if (
                    previous.run_id != run.id
                    or previous.invocation_id != invocation.id
                    or previous.payload_hash != digest
                ):
                    raise TraceCollectionError("tracing_batch_conflict", 409)
                return len(previous.spans), run.id
            if run.state in {"accepted", "exporting", "uncertain", "failed"} or invocation.finalized:
                raise TraceCollectionError("tracing_collection_closed", 409)
            if any(span.trace_id != run.trace_id for span in batch.spans):
                raise TraceCollectionError("tracing_trace_id_mismatch", 409)
            if run.span_count + len(batch.spans) > max_spans or run.payload_bytes + len(canonical) > max_bytes:
                raise TraceCollectionError("tracing_payload_limit", 413)
            spans: list[dict[str, Any]] = []
            for value in batch.spans:
                span = value.model_dump(mode="json")
                span["attributes"] = safe_attributes(span["attributes"], capture_content=run.capture_content)
                if not run.capture_content:
                    span["events"] = []
                    span["status_message"] = "Agent operation failed" if span["status"] == "error" else None
                spans.append(span)
            session.add(
                ApplicationTraceBatch(
                    id=str(batch.batch_id),
                    run_id=run.id,
                    invocation_id=invocation.id,
                    payload_hash=digest,
                    spans=spans,
                    final=batch.final,
                )
            )
            run.span_count += len(spans)
            run.payload_bytes += len(canonical)
            run.updated_at = naive_utc_now()
            if batch.final:
                invocation.finalized = True
                invocation.finalized_at = naive_utc_now()
            return len(spans), run.id

    def terminal(self, run_id: str, trace: dict[str, Any], root_span_id: str) -> None:
        with self.sessions.begin() as session:
            run = session.scalar(select(ApplicationTraceRun).where(ApplicationTraceRun.id == run_id).with_for_update())
            if run is None or run.state in {"accepted", "exporting", "uncertain", "failed"}:
                return
            if run.outer_trace is not None and run.outer_trace != trace:
                # A duplicate terminal task must not rewrite a completed immutable
                # span. The first persisted terminal envelope owns the export.
                return
            run.outer_trace = trace
            run.root_span_id = root_span_id
            run.terminal_at = run.terminal_at or naive_utc_now()
            run.updated_at = naive_utc_now()

    def get(self, run_id: str) -> ApplicationTraceRun | None:
        with self.sessions() as session:
            return session.get(ApplicationTraceRun, run_id)

    def collected(self, run_id: str) -> tuple[list[ApplicationTraceInvocation], list[ApplicationTraceBatch]]:
        with self.sessions() as session:
            invocations = list(
                session.scalars(
                    select(ApplicationTraceInvocation)
                    .where(
                        ApplicationTraceInvocation.run_id == run_id,
                    )
                    .order_by(
                        ApplicationTraceInvocation.attempt,
                        ApplicationTraceInvocation.created_at,
                        ApplicationTraceInvocation.id,
                    )
                )
            )
            batches = list(
                session.scalars(
                    select(ApplicationTraceBatch)
                    .where(ApplicationTraceBatch.run_id == run_id)
                    .order_by(ApplicationTraceBatch.created_at)
                )
            )
            return invocations, batches

    def claim(
        self, run_id: str, *, collection_timeout: int, lease_seconds: int
    ) -> tuple[ApplicationTraceRun, str] | None:
        now = naive_utc_now()
        with self.sessions.begin() as session:
            run = session.scalar(select(ApplicationTraceRun).where(ApplicationTraceRun.id == run_id).with_for_update())
            if run is None or run.state in {"not_collected", "accepted", "failed", "uncertain"}:
                return None
            if run.state == "exporting":
                last_heartbeat = run.export_heartbeat_at or run.export_started_at
                if last_heartbeat and last_heartbeat + timedelta(seconds=lease_seconds) < now:
                    run.state, run.error_code = "uncertain", "export_lease_expired"
                    run.updated_at = now
                return None
            if run.outer_trace is None:
                return None
            incomplete = session.scalar(
                select(ApplicationTraceInvocation.id)
                .where(ApplicationTraceInvocation.run_id == run_id, ApplicationTraceInvocation.finalized.is_(False))
                .limit(1)
            )
            if incomplete:
                if run.terminal_at and run.terminal_at + timedelta(seconds=collection_timeout) < now:
                    run.state, run.error_code = "failed", "agent_trace_collection_incomplete"
                    run.updated_at = now
                return None
            if run.next_attempt_at and run.next_attempt_at > now:
                return None
            app = session.scalar(select(App.id).where(App.id == run.app_id, App.tenant_id == run.tenant_id))
            if app is None:
                run.state, run.error_code = "failed", "tracing_owner_not_found"
                return None
            token = str(uuidv7())
            run.state = "exporting"
            run.export_token = token
            run.export_started_at = now
            run.export_heartbeat_at = now
            run.updated_at = now
            run.attempts += 1
            return run, token

    def renew_export_lease(self, run_id: str, token: str) -> bool:
        """Renew only the current export attempt, in a short independent transaction."""
        with self.sessions.begin() as session:
            run = session.scalar(select(ApplicationTraceRun).where(ApplicationTraceRun.id == run_id).with_for_update())
            if run is None or run.state != "exporting" or run.export_token != token:
                return False
            heartbeat_at = naive_utc_now()
            run.export_heartbeat_at = heartbeat_at
            run.updated_at = heartbeat_at
            return True

    def complete(
        self,
        run_id: str,
        token: str,
        *,
        state: str,
        error_code: str | None = None,
        result: Any = None,
        retry_delay: int | None = None,
    ) -> None:
        with self.sessions.begin() as session:
            run = session.scalar(select(ApplicationTraceRun).where(ApplicationTraceRun.id == run_id).with_for_update())
            if run is None or run.export_token != token:
                return
            late_acceptance = (
                state == "accepted"
                and result is not None
                and run.state == "uncertain"
                and run.error_code == "export_lease_expired"
            )
            if run.state != "exporting" and not late_acceptance:
                return
            run.state, run.error_code = state, error_code
            run.updated_at = naive_utc_now()
            run.export_token = None
            if result is not None:
                run.provider_trace_id, run.trace_url, run.span_urls = (
                    result.trace_id,
                    result.trace_url,
                    result.span_urls,
                )
                run.accepted_at = naive_utc_now()
            run.next_attempt_at = naive_utc_now() + timedelta(seconds=retry_delay) if retry_delay is not None else None

    def recovery_checked(self, run_id: str, *, error_code: str | None = None) -> None:
        """Rotate checked incomplete work without changing a concurrent export."""
        with self.sessions.begin() as session:
            run = session.scalar(select(ApplicationTraceRun).where(ApplicationTraceRun.id == run_id).with_for_update())
            if run is None or run.outer_trace is not None or run.state not in {"collecting", "ready"}:
                return
            run.updated_at = naive_utc_now()
            if error_code is not None:
                run.state, run.error_code = "failed", error_code

    def pending_ids(self, limit: int = 100) -> list[str]:
        with self.sessions() as session:
            return list(
                session.scalars(
                    select(ApplicationTraceRun.id)
                    .where(
                        ApplicationTraceRun.state.in_(["collecting", "ready", "retrying", "exporting"]),
                        or_(
                            ApplicationTraceRun.next_attempt_at.is_(None),
                            ApplicationTraceRun.next_attempt_at <= naive_utc_now(),
                        ),
                    )
                    .order_by(ApplicationTraceRun.terminal_at.is_(None), ApplicationTraceRun.updated_at)
                    .limit(limit)
                )
            )

    def retry(self, *, run_id: str, acknowledge_possible_duplicates: bool) -> None:
        with self.sessions.begin() as session:
            run = session.scalar(select(ApplicationTraceRun).where(ApplicationTraceRun.id == run_id).with_for_update())
            if run is None or run.state == "not_collected":
                raise TraceCollectionError("tracing_run_not_found", 404)
            if run.state == "accepted":
                raise TraceCollectionError("tracing_already_accepted", 409)
            if run.state not in {"failed", "uncertain"} or run.outer_trace is None:
                raise TraceCollectionError("tracing_retry_not_allowed", 409)
            incomplete = session.scalar(
                select(ApplicationTraceInvocation.id)
                .where(
                    ApplicationTraceInvocation.run_id == run.id,
                    ApplicationTraceInvocation.finalized.is_(False),
                )
                .limit(1)
            )
            if incomplete or (run.error_code or "").startswith("tracing_"):
                raise TraceCollectionError("tracing_retry_not_allowed", 409)
            if run.state == "uncertain" and not acknowledge_possible_duplicates:
                raise TraceCollectionError("tracing_duplicate_acknowledgement_required", 409)
            run.state, run.error_code, run.export_token = "ready", None, None
            run.next_attempt_at = None
            run.updated_at = naive_utc_now()

    def purge(self, *, retention_days: int, limit: int = 100) -> int:
        cutoff = naive_utc_now() - timedelta(days=retention_days)
        with self.sessions.begin() as session:
            ids = list(
                session.scalars(
                    select(ApplicationTraceRun.id)
                    .where(ApplicationTraceRun.created_at < cutoff)
                    .limit(limit)
                    .with_for_update()
                )
            )
            if not ids:
                return 0
            session.execute(delete(ApplicationTraceBatch).where(ApplicationTraceBatch.run_id.in_(ids)))
            session.execute(delete(ApplicationTraceInvocation).where(ApplicationTraceInvocation.run_id.in_(ids)))
            session.execute(delete(ApplicationTraceRun).where(ApplicationTraceRun.id.in_(ids)))
            return len(ids)
