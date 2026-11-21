"""LangSmith destination through the LangSmith SDK.

Each span becomes one complete run (outputs and end time included) with an
explicit trace ID and dotted order, so the SDK posts it synchronously and
``send`` returns only once LangSmith accepted every run. Run IDs derive from
the trace and span IDs. A root run takes the trace UUID, which is the message
or workflow run ID unless the caller supplied a trace ID, so a separately sent
fragment can attach under it without coordination.
"""

from collections.abc import Mapping
from datetime import datetime
from typing import Literal, NoReturn, override
from urllib.parse import urlencode, urlsplit, urlunsplit
from uuid import UUID

from dify_trace_sdk.egress import Egress, EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    TraceProviderError,
    VerificationError,
)
from dify_trace_sdk.exporting import classify_egress_error, export_endpoint, raise_for_export_status
from dify_trace_sdk.ids import span_uuid, trace_uuid
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from dify_trace_sdk.transports import EgressRequestsSession
from langsmith import Client
from pydantic import JsonValue
from urllib3.util.retry import Retry

from dify_trace_langsmith.config import LangSmithConfig

VERIFY_TIMEOUT_SECONDS = 10.0
DEFAULT_WEB_URL = "https://smith.langchain.com"
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "0.0.0.0", "::1", "0:0:0:0:0:0:0:1"})
_REGIONAL_WEB_URLS = (
    ("eu.", "https://eu.smith.langchain.com"),
    ("aws.", "https://aws.smith.langchain.com"),
    ("apac.", "https://apac.smith.langchain.com"),
    ("dev.", "https://dev.smith.langchain.com"),
    ("beta.", "https://beta.smith.langchain.com"),
)

type _RunType = Literal["chain", "llm", "retriever", "tool"]

_RUN_TYPES: Mapping[SpanKind, _RunType] = {
    SpanKind.CHAIN: "chain",
    SpanKind.LLM: "llm",
    SpanKind.RETRIEVER: "retriever",
    SpanKind.TOOL: "tool",
    SpanKind.AGENT: "chain",
}


def _web_url(endpoint: str) -> str:
    """The LangSmith web app serving an API endpoint, mapped like the SDK's ``get_host_url``.

    The SDK also counts hosts that resolve to loopback as local; resolving one
    here would reach the network outside the egress.
    """
    parsed = urlsplit(endpoint.rstrip("/"))
    host = parsed.hostname or ""
    if host in _LOCAL_HOSTS:
        return "http://localhost"
    for suffix in ("/api", "/api/v1"):
        if parsed.path.endswith(suffix):
            return urlunsplit(parsed._replace(path=parsed.path.removesuffix(suffix), query="", fragment=""))
    for prefix, web_url in _REGIONAL_WEB_URLS:
        if host.startswith(prefix):
            return web_url
    return DEFAULT_WEB_URL


def _first_session_field(sessions: list[object], field: str) -> str | None:
    """A UUID field of the first listed tracing project, or ``None`` when none is listed."""
    if not sessions:
        return None
    session = sessions[0]
    value = session.get(field) if isinstance(session, dict) else None
    if not isinstance(value, str):
        raise VerificationError("malformed_response")
    try:
        return str(UUID(value))
    except ValueError:
        raise VerificationError("malformed_response") from None


def _dotted_order(run_id: str, start_time: datetime, parent: str | None) -> str:
    """LangSmith's ordering key: one ``<UTC start>Z<run ID>`` segment per run from the trace root down."""
    segment = f"{start_time:%Y%m%dT%H%M%S%f}Z{run_id}"
    return segment if parent is None else f"{parent}.{segment}"


def _payload(value: JsonValue, key: str) -> dict[str, JsonValue]:
    """Run inputs and outputs are objects; any other value is wrapped under ``key``."""
    if isinstance(value, dict):
        return dict(value)
    return {} if value is None else {key: value}


def _usage(span: Span) -> dict[str, JsonValue]:
    """An LLM span's token counts and USD cost, keyed like LangSmith's ``usage_metadata``."""
    usage: dict[str, JsonValue] = {}
    if span.kind is not SpanKind.LLM:
        return usage
    if span.usage is not None:
        usage["input_tokens"] = span.usage.prompt_tokens
        usage["output_tokens"] = span.usage.completion_tokens
        usage["total_tokens"] = span.usage.total_tokens
    if span.cost is not None and span.cost.currency.upper() == "USD":
        usage["total_cost"] = span.cost.amount
    return usage


def _metadata(trace: Trace, span: Span) -> dict[str, JsonValue]:
    metadata: dict[str, JsonValue] = {**span.attributes, "dify_trace_id": trace.trace_id}
    if trace.session_id is not None:
        # LangSmith groups traces into threads by this key.
        metadata["session_id"] = trace.session_id
    if trace.external_trace_id is not None:
        metadata["external_trace_id"] = trace.external_trace_id
    if span.kind is SpanKind.LLM and span.model_name:
        # LangSmith labels model calls, and prices those sent without a cost, by these keys.
        metadata["ls_model_name"] = span.model_name
        if span.model_provider:
            metadata["ls_provider"] = span.model_provider
    return metadata


def _trace_run_id(trace: Trace) -> str:
    """The run the unit hangs from: the message or workflow run itself, or its root span when a
    caller's trace ID groups several of them, since LangSmith keeps one root run per trace."""
    if trace.external_trace_id is None:
        return str(trace_uuid(trace.trace_id))
    anchor = trace.parent.span_id if trace.parent is not None else trace.root.span_id
    return str(span_uuid(trace.trace_id, anchor))


def _run_link_base(project_url: str | None) -> str | None:
    """Run links need a project page; until the project exists, ``verify`` stores the project list."""
    if project_url is None or "/projects/p/" not in project_url:
        return None
    return project_url.rstrip("/")


def _export_failure(error: BaseException) -> TraceProviderError:
    """Recover the failure ``_ClassifyingEgress`` raised from the SDK's wrapping exceptions."""
    cause: BaseException | None = error
    while cause is not None:
        if isinstance(cause, TraceProviderError):
            return cause
        cause = cause.__cause__
    return ExportRejectedError("LangSmith rejected the trace")


class _ClassifyingEgress:
    """The egress the SDK exports through, classifying each failure while its HTTP status is known.

    The SDK folds most statuses into an untyped ``LangSmithError`` chained to
    whatever its session raised, so ``send`` recovers these errors from that chain.
    """

    def __init__(self, egress: Egress) -> None:
        self._egress = egress

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        content: bytes | None,
        timeout: float,
        sensitive_url: bool,
    ) -> EgressResponse:
        try:
            response = self._egress.request(
                method, url, headers=headers, content=content, timeout=timeout, sensitive_url=sensitive_url
            )
        except EgressError as error:
            raise classify_egress_error(error, "LangSmith") from None
        # LangSmith answers 409 for a run it already has, which the SDK counts as accepted.
        if response.status_code != 409:
            raise_for_export_status(response.status_code, "LangSmith")
        return response

    def grpc_channel(self, endpoint: str) -> NoReturn:
        raise EgressBlockedError("LangSmith export does not use gRPC")


class LangSmithProvider(TraceProvider[LangSmithConfig]):
    id = "langsmith"
    config_model = LangSmithConfig
    capabilities = ProviderCapabilities(native_cost=True, trace_url=True, span_url=True)

    @override
    def verify(self, config: LangSmithConfig) -> LangSmithConfig:
        # Like the SDK's ``_get_tenant_id``: any listed project names the key's workspace.
        tenant_id = _first_session_field(self._sessions(config, {"limit": "1"}), "tenant_id")
        # Like the SDK's ``read_project``.
        project_id = _first_session_field(
            self._sessions(config, {"limit": "1", "name": config.project, "include_stats": "false"}), "id"
        )
        web_url = _web_url(config.endpoint)
        if tenant_id is None:
            project_url = web_url
        elif project_id is None:
            # LangSmith creates the project with its first run.
            project_url = f"{web_url}/o/{tenant_id}/projects"
        else:
            project_url = f"{web_url}/o/{tenant_id}/projects/p/{project_id}"
        return config.model_copy(update={"project_url": project_url})

    def _sessions(self, config: LangSmithConfig, query: Mapping[str, str]) -> list[object]:
        """List tracing projects, which the LangSmith API calls sessions."""
        try:
            response = self.egress.request(
                "GET",
                f"{config.endpoint.rstrip('/')}/sessions?{urlencode(query)}",
                headers={"x-api-key": config.api_key, "Accept": "application/json"},
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
        except ValueError:
            raise VerificationError("malformed_response") from None
        if not isinstance(body, list):
            raise VerificationError("malformed_response")
        return body

    @override
    def project_url(self, config: LangSmithConfig) -> str | None:
        return config.project_url

    @override
    def send(self, config: LangSmithConfig, trace: Trace) -> SendResult:
        api_url = export_endpoint(config.endpoint)
        root_run_id = _trace_run_id(trace)
        run_ids = {span.span_id: str(span_uuid(trace.trace_id, span.span_id)) for span in trace.spans}
        dotted_orders: dict[str, str] = {}
        if trace.parent is None:
            run_ids[trace.root.span_id] = root_run_id
        else:
            # The trace root was sent in another unit; its run ID and dotted order are derivable.
            run_ids[trace.parent.span_id] = root_run_id
            dotted_orders[trace.parent.span_id] = _dotted_order(root_run_id, trace.parent.start_time, None)
        client = self._client(config, api_url)
        accepted: list[str] = []
        try:
            for span in trace.spans:
                run_id = run_ids[span.span_id]
                parent_order = dotted_orders[span.parent_span_id] if span.parent_span_id else None
                dotted_orders[span.span_id] = _dotted_order(run_id, span.start_time, parent_order)
                outputs = _payload(span.outputs, "output")
                if usage := _usage(span):
                    # Run ingestion takes token counts and costs from here, not from top-level run fields.
                    outputs["usage_metadata"] = usage
                client.create_run(
                    id=run_id,
                    name=span.name,
                    inputs=_payload(span.inputs, "input"),
                    outputs=outputs,
                    run_type=_RUN_TYPES[span.kind],
                    project_name=config.project,
                    start_time=span.start_time,
                    end_time=span.end_time,
                    parent_run_id=run_ids[span.parent_span_id] if span.parent_span_id else None,
                    trace_id=root_run_id,
                    dotted_order=dotted_orders[span.span_id],
                    extra={"metadata": _metadata(trace, span)},
                    error=(span.error or "Trace operation failed") if span.status is SpanStatus.ERROR else None,
                )
                accepted.append(run_id)
        except Exception as error:
            failure = _export_failure(error)
            if isinstance(failure, ExportRetryableError | ExportOutcomeUnknownError) and accepted:
                # Run IDs are deterministic and LangSmith answers 409 for runs it has, so resending is safe.
                raise ExportRetryableError("LangSmith accepted part of the trace") from None
            raise failure from None
        finally:
            client.close()
        link_base = _run_link_base(config.project_url)
        if link_base is None:
            return SendResult(trace_id=root_run_id, trace_url=None, span_urls={})
        return SendResult(
            trace_id=root_run_id,
            trace_url=f"{link_base}/r/{root_run_id}",
            span_urls={span.span_id: f"{link_base}/r/{run_ids[span.span_id]}" for span in trace.spans},
        )

    def _client(self, config: LangSmithConfig, api_url: str) -> Client:
        session = EgressRequestsSession(_ClassifyingEgress(self.egress))
        try:
            # Synchronous posts without a background thread or retries, no host runtime details,
            # no GET /info discovery, and every argument that would otherwise fall back to a
            # LANGSMITH_* environment variable pinned.
            return Client(
                api_url=api_url,
                api_key=config.api_key,
                session=session,
                retry_config=Retry(total=0),
                auto_batch_tracing=False,
                tracing_sampling_rate=1.0,
                tracing_mode="langsmith",
                omit_traced_runtime_info=True,
                hide_inputs=False,
                hide_outputs=False,
                hide_metadata=False,
                workspace_id="",
                info={},
                # Closing a client that uses the prompt cache shuts down the process-wide cache.
                disable_prompt_cache=True,
            )
        except Exception:
            # The SDK rejects some host environments, e.g. conflicting LANGSMITH_* endpoints.
            raise ExportRejectedError("LangSmith client could not be created") from None
