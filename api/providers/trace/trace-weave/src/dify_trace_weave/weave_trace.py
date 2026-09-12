"""Use Weave's Service API without wandb.login, weave.init or environment changes."""

from collections import deque
from collections.abc import Iterable, Iterator
from itertools import chain
from typing import Any
from urllib.parse import quote

from pydantic import JsonValue

from core.helper.ssl_context import create_ssl_context
from core.ops.provider_export import (
    TraceExportError,
    TraceProviderHttpClient,
    basic_auth,
    export_span_id,
    json_text,
    span_attributes,
)
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceSpan
from dify_trace_weave.config import WeaveConfig

# Weave 0.52.36 keeps 1 MiB below the server's 32 MiB request limit.
MAX_BATCH_BYTES = 31 * 1024 * 1024
MAX_COMPLETE_CALLS = 1000
MAX_LEGACY_EVENTS = 100


def _iter_call_batches(calls: Iterable[dict[str, JsonValue]], max_count: int) -> Iterator[list[dict[str, JsonValue]]]:
    batch: list[dict[str, JsonValue]] = []
    batch_bytes = len(b'{"batch":[]}')
    for call in calls:
        call_bytes = len(json_text(call).encode())
        if batch and (len(batch) >= max_count or batch_bytes + call_bytes + 1 > MAX_BATCH_BYTES):
            yield batch
            batch, batch_bytes = [], len(b'{"batch":[]}')
        batch_bytes += call_bytes + bool(batch)
        batch.append(call)
    if batch:
        yield batch


def _iter_legacy_call_events(calls: Iterable[dict[str, JsonValue]]) -> Iterator[dict[str, JsonValue]]:
    for call in calls:
        yield {
            "mode": "start",
            "req": {
                "start": {
                    key: value
                    for key, value in call.items()
                    if key not in {"ended_at", "exception", "output", "summary"}
                }
            },
        }
        yield {
            "mode": "end",
            "req": {
                "end": {key: call[key] for key in ("project_id", "id", "ended_at", "exception", "output", "summary")}
            },
        }


def _prepare_timed_spans(completed_trace: CompletedTrace) -> list[TraceSpan]:
    """Keep untimed details as marked instants at a captured endpoint, never export time."""
    spans: dict[str, TraceSpan] = {}
    for span in completed_trace.spans:
        if span.started_at is None or span.ended_at is None:
            parent = spans.get(span.parent_span_id or "")
            anchor = span.started_at or span.ended_at or (parent.started_at if parent else None)
            if anchor is None:
                raise TraceExportError("weave_span_time_missing")
            span = span.model_copy(
                update={
                    "started_at": anchor,
                    "ended_at": anchor,
                    "attributes": {
                        **span.attributes,
                        "dify.timing.estimated": True,
                        "dify.timing.source": "captured_endpoint",
                    },
                }
            )
        assert span.started_at is not None
        assert span.ended_at is not None
        if span.ended_at < span.started_at:
            raise TraceExportError("weave_span_time_invalid")
        spans[span.span_id] = span
    return list(spans.values())


def _make_span_tags(completed_trace: CompletedTrace, span: TraceSpan) -> list[JsonValue]:
    operation_type = span.attributes.get("operation_type", span.span_type)
    if not isinstance(operation_type, str):
        operation_type = span.span_type
    mode = span.attributes.get("conversation_mode", span.attributes.get("app_mode"))
    tags: list[str] = []
    if span.node_execution_id or span.attributes.get("node_execution_id") or span.span_type == "node":
        tags.append("node_execution")
    elif span.span_type == "workflow":
        tags.append("dify_workflow")
    elif operation_type == "message" or (operation_type == "llm" and isinstance(mode, str) and mode):
        # The legacy message generation inherited its message's tags.
        tags.append("message")
        if operation_type == "message" and completed_trace.source.workflow_run_id:
            tags.append("workflow")
        elif isinstance(mode, str) and mode:
            tags.append(mode)
    elif operation_type in {"moderation", "suggested_question", "dataset_retrieval", "generate_name"}:
        tags.append(operation_type)
    elif operation_type == "tool" or span.span_type == "tool":
        tags.append("tool")
        if isinstance(tool_name := span.attributes.get("tool_name", span.span_name), str) and tool_name:
            tags.append(tool_name)
    if isinstance(captured_tags := span.attributes.get("tags"), list):
        tags.extend(tag for tag in captured_tags if isinstance(tag, str))
    return list(dict.fromkeys(tags))


def _normalize_io(value: JsonValue, span: TraceSpan, *, output: bool = False) -> JsonValue:
    """Preserve Weave's message envelopes without modifying captured prompt data."""
    if value is None or value == {}:
        return value
    usage: dict[str, JsonValue] = {}
    for native, captured in (
        ("input_tokens", "prompt_tokens"),
        ("output_tokens", "completion_tokens"),
        ("total_tokens", "total_tokens"),
    ):
        usage[native] = span.usage.get(captured)
    files = span.attributes.get("files")
    file_urls: list[JsonValue] = []
    if isinstance(files, list):
        for file in files:
            url = file.get("url") if isinstance(file, dict) else file
            if isinstance(url, str) and url:
                file_urls.append(url)
    metadata: dict[str, JsonValue] = {"usage_metadata": usage, "file_list": file_urls}
    role = "ai" if output else "user"
    if isinstance(value, str):
        return {"choices" if output else "messages": {"role": role, "content": value, **metadata}}
    if isinstance(value, list):
        if value and all(isinstance(message, dict) for message in value):
            messages: list[JsonValue] = []
            for message in value:
                assert isinstance(message, dict)
                normalized = dict(message)
                # Saved Dify prompts use text; native content blocks and tool arguments must stay intact.
                if "text" in normalized and "content" not in normalized:
                    normalized["content"] = normalized.pop("text")
                messages.append(normalized if output else {**normalized, **metadata})
            if not output:
                return {"messages": messages}
            return {"choices": {"role": role, "content": messages, **metadata}}
        return {"choices": {"role": role, "content": str(value), **metadata}}
    if isinstance(value, dict):
        return {**value, **metadata}
    return value


class WeaveTraceClient:
    def __init__(self, provider_config: dict[str, Any]):
        self.config = WeaveConfig.model_validate(provider_config)
        runtime_settings = (
            provider_config["_runtime_settings"]
            if "_runtime_settings" in provider_config
            else WeaveConfig.load_runtime_settings(provider_config)
        )
        self.disabled = bool(runtime_settings.get("disabled", False))
        self.config = self.config.model_copy(
            update={key: runtime_settings[key] for key in ("host", "endpoint", "entity") if key in runtime_settings}
        )
        self.project_host = runtime_settings.get("project_host", self.config.host or "https://wandb.ai")
        self.account_ssl_context = create_ssl_context(runtime_settings.get("account_tls", {}))
        self.http = TraceProviderHttpClient(
            self.config.endpoint,
            {"Authorization": basic_auth("api", self.config.api_key)},
            request_timeout=float(runtime_settings.get("request_timeout", 30)),
            ssl_context=create_ssl_context(
                runtime_settings.get("tls", {}), verify=runtime_settings.get("verify", True)
            ),
        )
        self.account_http = TraceProviderHttpClient(
            self.config.host or "https://api.wandb.ai",
            self.http.headers,
            request_timeout=5,
            ssl_context=self.account_ssl_context,
        )
        self._ready_project_id: str | None = None

    def _account_query(self, query: str, variables: dict[str, str] | None = None) -> dict[str, Any]:
        self.account_http.deadline = self.http.deadline
        try:
            response = self.account_http.request(
                "POST", "graphql", json={"query": query, "variables": variables or {}}
            ).json()
        except ValueError:
            raise TraceExportError("weave_account_response_invalid") from None
        if not isinstance(response, dict) or not isinstance(response.get("data"), dict):
            raise TraceExportError("weave_account_response_invalid")
        if response.get("errors"):
            raise TraceExportError("weave_account_query_failed")
        return response["data"]

    def _project_id(self) -> str:
        if self._ready_project_id is not None:
            return self._ready_project_id
        entity = self.config.entity
        project = self.config.project
        if not entity and "/" in project:
            entity, project = project.split("/", 1)
            if not entity:
                raise TraceExportError("weave_project_invalid")
        if entity is None:
            viewer = self._account_query("query { viewer { defaultEntity { name } } }").get("viewer")
            default_entity = viewer.get("defaultEntity") if isinstance(viewer, dict) else None
            entity = default_entity.get("name") if isinstance(default_entity, dict) else None
        if not isinstance(entity, str) or not entity:
            raise TraceExportError("weave_entity_unavailable")
        if not project or "/" in entity or "/" in project:
            raise TraceExportError("weave_project_invalid")
        return f"{entity}/{project}"

    def _ensure_project_id(self) -> str:
        if self._ready_project_id is not None:
            return self._ready_project_id
        entity, project = self._project_id().split("/", 1)
        variables = {"entity": entity, "name": project}
        result = self._account_query(
            "query($entity: String!, $name: String!) { project(entityName: $entity, name: $name) { name } }",
            variables,
        )
        if "project" not in result:
            raise TraceExportError("weave_account_response_invalid")
        project_data = result["project"]
        if project_data is None:
            result = self._account_query(
                "mutation($entity: String!, $name: String!) { "
                "upsertModel(input: {entityName: $entity, name: $name}) { model { name } } }",
                variables,
            )
            upsert = result.get("upsertModel")
            project_data = upsert.get("model") if isinstance(upsert, dict) else None
        name = project_data.get("name") if isinstance(project_data, dict) else None
        if not isinstance(name, str) or not name or "/" in name:
            raise TraceExportError("weave_project_unavailable")
        self._ready_project_id = f"{entity}/{name}"
        return self._ready_project_id

    def verify_credentials(self) -> bool:
        if self.disabled:
            return False
        self.http.request("POST", "calls/query_stats", json={"project_id": self._ensure_project_id()})
        return True

    def get_project_url(self) -> str:
        host = self.project_host.rstrip("/")
        if self.disabled:
            return f"{host}/"
        try:
            return f"{host}/{quote(self._project_id(), safe='/')}/weave"
        except Exception:
            # Project discovery must not prevent reading saved settings.
            return f"{host}/"

    def _send_calls(self, project_id: str, calls: list[dict[str, JsonValue]]) -> None:
        path = f"v2/{quote(project_id, safe='/')}/calls/complete"
        batches = deque(_iter_call_batches(calls, MAX_COMPLETE_CALLS))
        while batches:
            batch = batches.popleft()
            try:
                self.http.request("POST", path, json={"batch": batch})
            except TraceExportError as error:
                if str(error) == "provider_http_413" and len(batch) > 1:
                    middle = len(batch) // 2
                    batches.appendleft(batch[middle:])
                    batches.appendleft(batch[:middle])
                elif str(error) == "provider_http_404" and path != "call/upsert_batch":
                    # Older servers support the native start/end batch endpoint.
                    # Only convert pending calls; accepted batches must not be replayed.
                    path = "call/upsert_batch"
                    pending_calls = chain(batch, chain.from_iterable(batches))
                    batches = deque(_iter_call_batches(_iter_legacy_call_events(pending_calls), MAX_LEGACY_EVENTS))
                else:
                    raise

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        trace_id = (
            str(parent_span["trace_id"])
            if parent_span
            else completed_trace.source.external_trace_id or completed_trace.trace_id
        )
        if self.disabled or (parent_span is not None and parent_span.get("disabled") is True):
            return ExportedParentSpans(
                spans={
                    span.span_id: {
                        "trace_id": trace_id,
                        "span_id": export_span_id(completed_trace, span.span_id),
                        "disabled": True,
                    }
                    for span in completed_trace.spans
                }
            )
        spans = _prepare_timed_spans(completed_trace)
        # Timing is checked before project discovery, which can itself send a request.
        project_id = self._ensure_project_id()
        calls: list[dict[str, JsonValue]] = []
        for span in spans:
            assert span.started_at is not None
            assert span.ended_at is not None
            inputs = span.inputs
            if span.node_execution_id and span.attributes.get("node_type") in (
                "question-classifier",
                "parameter-extractor",
            ):
                inputs = span.attributes.get("original_inputs", inputs)
            inputs = _normalize_io(inputs, span)
            has_error = span.status == "error" or (
                span.status == "cancelled" and span.span_type == "workflow" and bool(span.error)
            )
            start: dict[str, JsonValue] = {
                "project_id": project_id,
                "id": export_span_id(completed_trace, span.span_id),
                "op_name": span.span_name,
                "trace_id": trace_id,
                "parent_id": export_span_id(completed_trace, span.parent_span_id)
                if span.parent_span_id
                else (parent_span["span_id"] if parent_span else None),
                "started_at": span.started_at.isoformat(),
                "attributes": {
                    **span_attributes(completed_trace, span),
                    "tags": _make_span_tags(completed_trace, span),
                },
                "inputs": inputs if isinstance(inputs, dict) else {} if inputs is None else {"inputs": str(inputs)},
                "wb_user_id": None,
            }
            summary: dict[str, JsonValue] = {
                "status_counts": {"error": int(has_error), "success": int(not has_error)},
                "weave": {"latency_ms": (span.ended_at - span.started_at).total_seconds() * 1000},
            }
            if span.span_type == "llm":
                summary["usage"] = {str(span.attributes.get("model_name", "unknown")): span.usage}
            end: dict[str, JsonValue] = {
                "project_id": project_id,
                "id": start["id"],
                "ended_at": span.ended_at.isoformat(),
                "exception": span.error if has_error else None,
                "output": _normalize_io(span.outputs, span, output=True),
                "summary": summary,
            }
            calls.append({**start, **end})
        self._send_calls(project_id, calls)
        return ExportedParentSpans(
            spans={
                span.span_id: {"trace_id": trace_id, "span_id": export_span_id(completed_trace, span.span_id)}
                for span in completed_trace.spans
            }
        )
