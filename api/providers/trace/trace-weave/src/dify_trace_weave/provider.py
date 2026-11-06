"""Weave destination over the trace server's call API.

Each span becomes one Weave call, started parent-first and ended children-first
as the Weave SDK does. Call IDs derive from span IDs, so a redelivered unit
reuses the IDs of its first delivery. Starts and ends are separate requests, so
a failure after the first accepted call leaves the outcome unknown. The W&B
GraphQL API is only read, to verify a configuration and to resolve an unset
entity. The ``weave`` package is not imported because importing it patches PIL
for the whole process.
"""

import base64
from collections.abc import Mapping
from typing import override
from urllib.parse import quote, urlsplit
from uuid import UUID

from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.exporting import json_value, send_export_request
from dify_trace_sdk.ids import span_uuid, trace_uuid
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

from dify_trace_weave.config import DEFAULT_HOST, WeaveConfig

VERIFY_TIMEOUT_SECONDS = 10.0
PUBLIC_CONSOLE_URL = "https://wandb.ai"
# The trace server rejects calls whose names are longer than these.
MAX_OP_NAME_LENGTH = 128
MAX_DISPLAY_NAME_LENGTH = 1024

_VIEWER_QUERY = "query DifyWeaveViewer { viewer { id entity } }"
_PROJECT_QUERY = """query DifyWeaveProject($entity: String!, $project: String!) {
  viewer { id }
  project(name: $project, entityName: $entity) { id name entityName readOnly }
}"""


class _InvalidNameError(ValueError):
    """An entity or project is not a usable W&B name."""


class _Viewer(BaseModel):
    id: str = Field(min_length=1)
    entity: str | None = None

    model_config = ConfigDict(strict=True)


class _Project(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    entity_name: str = Field(alias="entityName", min_length=1)
    read_only: bool | None = Field(alias="readOnly")

    model_config = ConfigDict(strict=True)


class _CallStats(BaseModel):
    count: int = Field(ge=0)

    model_config = ConfigDict(strict=True)


def _name(value: str) -> str:
    name = value.strip()
    if not name or name in {".", ".."} or any(char in "/\\" or ord(char) < 32 or ord(char) == 127 for char in name):
        raise _InvalidNameError
    return name


def _target(config: WeaveConfig) -> tuple[str | None, str]:
    """The entity, None when the API key's default entity applies, and the project.

    Raises:
        _InvalidNameError: A name is unusable, or an ``entity/project`` path conflicts with ``entity``.
    """
    entity = config.entity.strip() if config.entity else None
    project = config.project.strip()
    if "/" in project:
        if entity:
            raise _InvalidNameError
        entity, _, project = project.partition("/")
        return _name(entity), _name(project)
    return (_name(entity) if entity else None), _name(project)


def _api_host(config: WeaveConfig) -> str:
    return (config.host or DEFAULT_HOST).rstrip("/")


def _console_url(config: WeaveConfig) -> str:
    """The W&B UI: the public API host maps to wandb.ai, other hosts serve the UI themselves."""
    host = _api_host(config)
    parsed = urlsplit(host)
    if (
        parsed.scheme == "https"
        and parsed.hostname == "api.wandb.ai"
        and parsed.port in {None, 443}
        and not parsed.path
    ):
        return PUBLIC_CONSOLE_URL
    return host


def _project_url(config: WeaveConfig, entity: str, project: str) -> str:
    return f"{_console_url(config)}/{quote(entity, safe='')}/{quote(project, safe='')}"


def _headers(config: WeaveConfig) -> dict[str, str]:
    token = base64.b64encode(f"api:{config.api_key}".encode()).decode()
    return {"Authorization": f"Basic {token}", "Content-Type": "application/json", "Accept": "application/json"}


def _json(response: EgressResponse) -> object:
    try:
        return response.json()
    except ValueError:
        return None


def _lookup(document: object, *path: str) -> object:
    """The value at ``path`` in a JSON document, or None when the document has another shape."""
    for key in path:
        document = document.get(key) if isinstance(document, dict) else None
    return document


def _same_id(value: object, expected: str) -> bool:
    """Whether ``value`` names the ``expected`` UUID, in any spelling."""
    if not isinstance(value, str):
        return False
    try:
        return UUID(value) == UUID(expected)
    except ValueError:
        return False


def _call_id(trace: Trace, span_id: str) -> str:
    return str(span_uuid(trace.trace_id, span_id))


def _inputs(value: JsonValue) -> dict[str, JsonValue]:
    """Weave call inputs must be an object."""
    if isinstance(value, dict):
        return value
    return {} if value is None else {"input": value}


def _summary(span: Span) -> dict[str, object]:
    """Weave reads token usage per model name from the call summary."""
    if span.kind is not SpanKind.LLM or span.usage is None:
        return {}
    return {
        "usage": {
            span.model_name or "unknown": {
                "prompt_tokens": span.usage.prompt_tokens,
                "completion_tokens": span.usage.completion_tokens,
                "total_tokens": span.usage.total_tokens,
                "requests": 1,
            }
        }
    }


def _call_bodies(trace: Trace, project_id: str, trace_key: str) -> tuple[list[bytes], list[bytes]]:
    """Encoded call starts in parent-first order and call ends in children-first order."""
    thread_id = trace.session_id or None
    # Weave counts a call as a conversation turn when its id is its turn_id. Every
    # call of a root unit carries the root's id; fragments carry none, so they
    # never count as turns of their own.
    turn_id = _call_id(trace, trace.root.span_id) if thread_id and trace.parent is None else None
    starts = [
        {
            "start": {
                "project_id": project_id,
                "id": _call_id(trace, span.span_id),
                "op_name": span.name[:MAX_OP_NAME_LENGTH],
                "display_name": span.name[:MAX_DISPLAY_NAME_LENGTH],
                "trace_id": trace_key,
                "parent_id": _call_id(trace, span.parent_span_id) if span.parent_span_id else None,
                "thread_id": thread_id,
                "turn_id": turn_id,
                "started_at": span.start_time.isoformat(),
                "attributes": {**span.attributes, "dify_span_kind": span.kind.value, "dify_span_id": span.span_id},
                "inputs": _inputs(span.inputs),
            }
        }
        for span in trace.spans
    ]
    ends = [
        {
            "end": {
                "project_id": project_id,
                "id": _call_id(trace, span.span_id),
                "ended_at": span.end_time.isoformat(),
                "exception": (span.error or "Span failed") if span.status is SpanStatus.ERROR else None,
                "output": span.outputs,
                "summary": _summary(span),
            }
        }
        for span in reversed(trace.spans)
    ]
    try:
        return [json_value(body).encode() for body in starts], [json_value(body).encode() for body in ends]
    except ValueError:
        raise ExportRejectedError("Weave trace contains numbers that JSON cannot represent") from None


def _acknowledged(response: EgressResponse, call_id: str, trace_key: str) -> bool:
    """Whether a call start response echoes the submitted call and trace IDs."""
    body = _json(response)
    return _same_id(_lookup(body, "id"), call_id) and _same_id(_lookup(body, "trace_id"), trace_key)


class WeaveProvider(TraceProvider[WeaveConfig]):
    id = "weave"
    config_model = WeaveConfig
    capabilities = ProviderCapabilities(native_cost=False, trace_url=True, span_url=True)

    @override
    def verify(self, config: WeaveConfig) -> WeaveConfig:
        """Check the credentials, an existing writable project, and the trace server's read API."""
        if not config.api_key.strip():
            raise VerificationError("authentication_failed")
        try:
            entity, project = _target(config)
            if entity is None:
                entity = self._viewer_entity(config)
            self._verify_project(config, entity, project)
            stats = self._verify_request(
                config,
                f"{config.endpoint.rstrip('/')}/calls/query_stats",
                {"project_id": f"{entity}/{project}", "limit": 1},
            )
            _CallStats.model_validate(stats)
        except _InvalidNameError:
            raise VerificationError("invalid_project") from None
        except ValidationError:
            raise VerificationError("malformed_response") from None
        return config.model_copy(update={"entity": entity, "project": project})

    @override
    def project_url(self, config: WeaveConfig) -> str | None:
        try:
            entity, project = _target(config)
        except _InvalidNameError:
            return _console_url(config)
        return _project_url(config, entity, project) if entity else _console_url(config)

    @override
    def send(self, config: WeaveConfig, trace: Trace) -> SendResult:
        try:
            entity, project = _target(config)
        except _InvalidNameError:
            raise ExportRejectedError("Weave entity or project name is invalid") from None
        if entity is None:
            entity = self._default_entity(config)
        trace_key = str(trace_uuid(trace.trace_id))
        starts, ends = _call_bodies(trace, f"{entity}/{project}", trace_key)
        endpoint = config.endpoint.rstrip("/")
        written = False
        try:
            for span, start in zip(trace.spans, starts, strict=True):
                response = self._post(config, f"{endpoint}/call/start", start)
                written = True
                if not _acknowledged(response, _call_id(trace, span.span_id), trace_key):
                    raise ExportOutcomeUnknownError("Weave did not acknowledge the submitted call identifiers")
            for end in ends:
                self._post(config, f"{endpoint}/call/end", end)
        except (ExportRetryableError, ExportRejectedError):
            if written:
                raise ExportOutcomeUnknownError("Weave accepted only part of the trace") from None
            raise
        calls_url = f"{_project_url(config, entity, project)}/r/call"
        root_span_id = trace.parent.span_id if trace.parent is not None else trace.root.span_id
        return SendResult(
            trace_id=trace_key,
            trace_url=f"{calls_url}/{_call_id(trace, root_span_id)}",
            span_urls={span.span_id: f"{calls_url}/{_call_id(trace, span.span_id)}" for span in trace.spans},
        )

    def _post(self, config: WeaveConfig, url: str, content: bytes) -> EgressResponse:
        return send_export_request(
            self.egress,
            "POST",
            url,
            destination="Weave",
            headers=_headers(config),
            content=content,
            sensitive_url=False,
        )

    def _default_entity(self, config: WeaveConfig) -> str:
        """Resolve the API key's default entity, which Weave uses when none is configured."""
        try:
            response = self._post(config, f"{_api_host(config)}/graphql", json_value({"query": _VIEWER_QUERY}).encode())
        except ExportOutcomeUnknownError:
            # The lookup only reads, so a lost answer cannot have written anything.
            raise ExportRetryableError("Weave entity lookup failed in transport") from None
        entity = _lookup(_json(response), "data", "viewer", "entity")
        try:
            return _name(entity if isinstance(entity, str) else "")
        except _InvalidNameError:
            raise ExportRejectedError("Weave could not resolve the default entity of the API key") from None

    def _viewer_entity(self, config: WeaveConfig) -> str:
        data = self._graphql(config, {"query": _VIEWER_QUERY})
        if "viewer" not in data:
            raise VerificationError("malformed_response")
        if data["viewer"] is None:
            raise VerificationError("authentication_failed")
        return _name(_Viewer.model_validate(data["viewer"]).entity or "")

    def _verify_project(self, config: WeaveConfig, entity: str, project: str) -> None:
        data = self._graphql(config, {"query": _PROJECT_QUERY, "variables": {"entity": entity, "project": project}})
        if "viewer" not in data or "project" not in data:
            raise VerificationError("malformed_response")
        if data["viewer"] is None:
            raise VerificationError("authentication_failed")
        _Viewer.model_validate(data["viewer"])
        if data["project"] is None:
            raise VerificationError("project_not_found_or_inaccessible")
        found = _Project.model_validate(data["project"])
        if found.name != project or found.entity_name != entity:
            raise VerificationError("invalid_project")
        if found.read_only is None:
            raise VerificationError("project_permission_unknown")
        if found.read_only:
            raise VerificationError("project_read_only")

    def _graphql(self, config: WeaveConfig, body: Mapping[str, object]) -> dict[str, object]:
        """Run a W&B GraphQL query and return its ``data``."""
        answer = self._verify_request(config, f"{_api_host(config)}/graphql", body)
        errors = answer.get("errors")
        if errors is not None and not isinstance(errors, list):
            raise VerificationError("malformed_response")
        if errors:
            raise VerificationError("graphql_error")
        data = answer.get("data")
        if not isinstance(data, dict):
            raise VerificationError("malformed_response")
        return data

    def _verify_request(self, config: WeaveConfig, url: str, body: Mapping[str, object]) -> dict[str, object]:
        try:
            response = self.egress.request(
                "POST",
                url,
                headers=_headers(config),
                content=json_value(body).encode(),
                timeout=VERIFY_TIMEOUT_SECONDS,
                sensitive_url=False,
            )
        except EgressError:
            raise VerificationError("connection_failed") from None
        if response.status_code == 401:
            raise VerificationError("authentication_failed")
        if response.status_code == 403:
            raise VerificationError("permission_denied")
        if not 200 <= response.status_code < 300:
            raise VerificationError("endpoint_unavailable")
        answer = _json(response)
        if not isinstance(answer, dict):
            raise VerificationError("malformed_response")
        return answer
