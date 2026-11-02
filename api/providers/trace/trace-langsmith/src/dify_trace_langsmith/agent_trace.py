"""Canonical Agent trees mapped to synchronous, isolated LangSmith runs."""

from collections.abc import Mapping
from typing import Any
from urllib.parse import quote
from uuid import NAMESPACE_URL, uuid5

from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.utils import generate_dotted_order
from services.tracing.provider_common import endpoint, finished_at, required, token_usage, usd_cost, utc
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportResult, TraceExportUncertainError
from services.tracing.sdk_transport import SSRFSession


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    from langsmith import Client
    from urllib3.util.retry import Retry

    api_url = endpoint(config.get("endpoint", "https://api.smith.langchain.com"))
    project = required(config, "project")
    ids = {span.id: str(uuid5(NAMESPACE_URL, f"dify:{trace.trace_id}:{span.id}")) for span in trace.spans}
    root_id = ids[trace.root_span_id]
    orders: dict[str, str] = {}
    accepted: set[str] = set()
    client = Client(
        api_key=required(config, "api_key"),
        api_url=api_url,
        session=SSRFSession(provider),
        retry_config=Retry(total=0),
        auto_batch_tracing=False,
        tracing_sampling_rate=1.0,
        tracing_mode="langsmith",
        omit_traced_runtime_info=True,
        hide_inputs=False,
        hide_outputs=False,
        info={},
    )
    try:
        for span in trace.spans:
            orders[span.id] = generate_dotted_order(
                ids[span.id], utc(span.start_time), orders.get(span.parent_id or "")
            )
            metadata = {
                **span.metadata,
                "session_id": trace.session_id,
                "external_trace_id": trace.trace_id,
                "dify.span.id": span.id,
                "dify.span.kind": span.kind.value,
            }
            model = span.metadata.get("model") or span.metadata.get("model_name")
            if span.kind is CanonicalSpanKind.LLM and model:
                metadata["ls_model_name"] = model
                metadata["ls_provider"] = span.metadata.get("model_provider")
            values: dict[str, Any] = {}
            usage = token_usage(span)
            values.update(
                {f"{key}_tokens" if key != "total" else "total_tokens": value for key, value in usage.items()}
            )
            cost = usd_cost(span)
            if cost is not None:
                values["total_cost"] = cost
            outputs = dict(span.outputs) if isinstance(span.outputs, Mapping) else {"output": span.outputs}
            if usage:
                outputs["usage_metadata"] = {f"{key}_tokens": value for key, value in usage.items()}
            client.create_run(
                id=ids[span.id],
                name=span.name,
                inputs=dict(span.inputs) if isinstance(span.inputs, Mapping) else {"input": span.inputs},
                outputs=outputs,
                run_type="chain" if span.kind is CanonicalSpanKind.AGENT else span.kind.value,
                project_name=project,
                start_time=utc(span.start_time),
                end_time=finished_at(span),
                parent_run_id=ids.get(span.parent_id or ""),
                trace_id=root_id,
                dotted_order=orders[span.id],
                extra={"metadata": metadata},
                error=(span.error or "Trace operation failed") if span.status is CanonicalSpanStatus.ERROR else None,
                **values,
            )
            accepted.add(span.id)
    except Exception as error:
        if accepted:
            raise TraceExportUncertainError(
                "LangSmith accepted part of the trace; reconciliation is required"
            ) from None
        # LangSmith wraps injected transport exceptions; recover our sanitized outcome.
        cause: BaseException | None = error
        while cause is not None:
            if isinstance(cause, (RetryableTraceDispatchError, TraceExportRejectedError)):
                raise cause from None
            cause = cause.__cause__
        raise TraceExportRejectedError("LangSmith rejected the trace") from None
    finally:
        client.close()
    project_url = config.get("project_url")
    trace_url = f"{str(project_url).rstrip('/')}/r/{quote(root_id)}" if project_url else None
    return TraceExportResult(
        trace_id=root_id,
        trace_url=trace_url,
        span_urls={span.id: f"{str(project_url).rstrip('/')}/r/{ids[span.id]}" for span in trace.spans}
        if project_url
        else {},
    )
