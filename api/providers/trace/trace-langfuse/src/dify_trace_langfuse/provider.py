"""Langfuse destination over the public ingestion API.

Each trace unit becomes ingestion events: the root span is the Langfuse trace
and every other span an observation (a generation for LLM calls). Langfuse
upserts by ID, so re-sending a unit after a partial failure is safe.
"""

import base64
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from typing import override
from urllib.parse import quote
from uuid import uuid5

from dify_trace_sdk.errors import (
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.exporting import export_endpoint, json_value, send_export_request
from dify_trace_sdk.ids import span_uuid, trace_uuid
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from pydantic import JsonValue

from dify_trace_langfuse.config import LangfuseConfig

VERIFY_TIMEOUT_SECONDS = 10.0
MAX_BATCH_BYTES = 3_000_000
"""Stay below Langfuse Cloud's ingestion request limit."""


def _iso(value: datetime) -> str:
    return value.isoformat()


def _messages(value: JsonValue, *, role: str) -> JsonValue:
    """Preserve Langfuse's chat preview without rewriting multimodal content blocks."""
    if isinstance(value, str):
        return [{"role": role, "content": value}]
    if isinstance(value, list):
        return [
            {("content" if key == "text" else key): part for key, part in item.items()}
            if isinstance(item, dict) and "role" in item and "content" not in item
            else item
            for item in value
        ]
    return value


class LangfuseProvider(TraceProvider[LangfuseConfig]):
    id = "langfuse"
    config_model = LangfuseConfig
    capabilities = ProviderCapabilities(native_cost=True, trace_url=True, span_url=True)

    @staticmethod
    def _headers(config: LangfuseConfig) -> dict[str, str]:
        token = base64.b64encode(f"{config.public_key}:{config.secret_key}".encode()).decode()
        return {"Authorization": f"Basic {token}", "Accept": "application/json"}

    @override
    def verify(self, config: LangfuseConfig) -> LangfuseConfig:
        try:
            response = self.egress.request(
                "GET",
                f"{config.host.rstrip('/')}/api/public/projects",
                headers=self._headers(config),
                content=None,
                timeout=VERIFY_TIMEOUT_SECONDS,
                sensitive_url=False,
            )
        except EgressError:
            raise VerificationError("connection_failed") from None
        if response.status_code in {401, 403}:
            raise VerificationError("authentication_failed")
        if not 200 <= response.status_code < 300:
            raise VerificationError("endpoint_unavailable")
        try:
            body = response.json()
            projects = body["data"] if isinstance(body, dict) else None
            project_id = projects[0]["id"] if isinstance(projects, list) and projects else None
        except (ValueError, KeyError, TypeError):
            raise VerificationError("malformed_response") from None
        if not isinstance(project_id, str) or not project_id:
            raise VerificationError("project_not_found")
        return config.model_copy(update={"project_key": project_id})

    @override
    def project_url(self, config: LangfuseConfig) -> str:
        host = config.host.rstrip("/")
        return f"{host}/project/{config.project_key}" if config.project_key else config.project_url or host

    @override
    def send(self, config: LangfuseConfig, trace: Trace) -> SendResult:
        host = export_endpoint(config.host)
        trace_key = trace.external_trace_id or str(trace_uuid(trace.trace_id))
        events = self._events(trace, trace_key)
        for batch in self._batches(events):
            try:
                response = send_export_request(
                    self.egress,
                    "POST",
                    f"{host}/api/public/ingestion",
                    destination="Langfuse",
                    headers={**self._headers(config), "Content-Type": "application/json"},
                    content=batch,
                    sensitive_url=False,
                )
            except ExportOutcomeUnknownError:
                raise ExportRetryableError("Langfuse ingestion outcome is unknown; re-sending is idempotent") from None
            try:
                body = response.json() if response.content else {}
            except ValueError:
                # Something between Dify and Langfuse answered; re-sending is idempotent.
                raise ExportRetryableError("Langfuse ingestion answered with an unreadable body") from None
            self._check_results(body)
        trace_url = (
            f"{self.project_url(config).rstrip('/')}/traces/{quote(trace_key, safe='')}"
            if config.project_key or config.project_url
            else None
        )
        span_urls = (
            {
                span.span_id: f"{trace_url}?observation={self._observation_id(trace, span.span_id)}"
                for span in trace.spans
            }
            if trace_url
            else {}
        )
        return SendResult(trace_id=trace_key, trace_url=trace_url, span_urls=span_urls)

    @staticmethod
    def _observation_id(trace: Trace, span_id: str) -> str:
        return str(span_uuid(trace.trace_id, span_id))

    def _events(self, trace: Trace, trace_key: str) -> list[dict[str, object]]:
        events: list[dict[str, object]] = []
        if trace.parent is None:
            root = trace.root
            events.append(
                self._event(
                    trace,
                    "trace-create",
                    {
                        "id": trace_key,
                        "name": root.name,
                        "timestamp": _iso(root.start_time),
                        "userId": trace.user_id,
                        "sessionId": trace.session_id,
                        "input": _messages(root.inputs, role="user"),
                        "output": _messages(root.outputs, role="assistant"),
                        "metadata": {**root.attributes, "dify_trace_id": trace.trace_id},
                    },
                )
            )
            # The trace itself represents the root; its children are top-level observations.
            trace_level_span_id = root.span_id
            observations: Sequence[Span] = trace.spans[1:]
        else:
            trace_level_span_id = trace.parent.span_id
            observations = trace.spans
        for span in observations:
            parent = (
                None
                if span.parent_span_id == trace_level_span_id or span.parent_span_id is None
                else self._observation_id(trace, span.parent_span_id)
            )
            body: dict[str, object] = {
                "id": self._observation_id(trace, span.span_id),
                "traceId": trace_key,
                "parentObservationId": parent,
                "name": span.name,
                "startTime": _iso(span.start_time),
                "endTime": _iso(span.end_time),
                "input": _messages(span.inputs, role="user"),
                "output": _messages(span.outputs, role="assistant"),
                "metadata": {**span.attributes, "dify_span_kind": span.kind.value},
                "level": "ERROR" if span.status is SpanStatus.ERROR else "DEFAULT",
                "statusMessage": span.error,
            }
            if span.kind is SpanKind.LLM:
                body.update(self._generation_fields(span))
                events.append(self._event(trace, "generation-create", body))
            else:
                events.append(self._event(trace, "span-create", body))
        return events

    @staticmethod
    def _generation_fields(span: Span) -> dict[str, object]:
        fields: dict[str, object] = {"model": span.model_name}
        if span.usage is not None:
            usage: dict[str, object] = {
                "input": span.usage.prompt_tokens,
                "output": span.usage.completion_tokens,
                "total": span.usage.total_tokens,
                "unit": "TOKENS",
            }
            if span.cost is not None and span.cost.currency.upper() == "USD":
                usage["totalCost"] = span.cost.amount
            fields["usage"] = usage
        if span.time_to_first_token is not None:
            fields["completionStartTime"] = _iso(span.start_time + timedelta(seconds=span.time_to_first_token))
        return fields

    @staticmethod
    def _event(trace: Trace, event_type: str, body: Mapping[str, object]) -> dict[str, object]:
        # Deterministic event IDs let Langfuse deduplicate a redelivered unit.
        return {
            "id": str(uuid5(trace_uuid(trace.trace_id), f"{event_type}:{body['id']}")),
            "type": event_type,
            "timestamp": body.get("startTime") or body.get("timestamp"),
            "body": {key: value for key, value in body.items() if value is not None},
        }

    @staticmethod
    def _batches(events: list[dict[str, object]]) -> list[bytes]:
        batches: list[bytes] = []
        current: list[bytes] = []
        size = 0
        for event in events:
            encoded = json_value(event).encode()
            if current and size + len(encoded) > MAX_BATCH_BYTES:
                batches.append(b'{"batch":[' + b",".join(current) + b"]}")
                current, size = [], 0
            current.append(encoded)
            size += len(encoded) + 1
        batches.append(b'{"batch":[' + b",".join(current) + b"]}")
        return batches

    @staticmethod
    def _check_results(body: object) -> None:
        errors = body.get("errors") if isinstance(body, dict) else None
        if not isinstance(errors, list) or not errors:
            return
        statuses = [error.get("status") for error in errors if isinstance(error, dict)]
        if any(isinstance(status, int) and (status == 429 or status >= 500) for status in statuses):
            raise ExportRetryableError("Langfuse could not ingest every event; re-sending is idempotent")
        raise ExportRejectedError(f"Langfuse rejected {len(errors)} ingestion events")
