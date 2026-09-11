"""Enterprise signal contracts projected from captured executions without record lookups."""

import base64
import logging
import os
import socket
import ssl
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import InstrumentationScope
from opentelemetry.proto.metrics.v1.metrics_pb2 import Metric
from opentelemetry.proto.trace.v1.trace_pb2 import ResourceSpans, ScopeSpans
from opentelemetry.util.re import _LIBERAL_HEADER_PATTERN, parse_env_headers
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient, counter, histogram, otlp_span, otlp_trace_id
from core.ops.provider_export import TraceProviderHttpClient, export_span_id, json_text, span_attributes, span_id_bytes
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceSpan

# Preserve the explicit buckets used by the previous enterprise SDK histograms.
HISTOGRAM_BOUNDS = (0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000)


def load_enterprise_config() -> dict[str, Any] | None:
    from configs import dify_config
    from enterprise.telemetry.exporter import _parse_otlp_headers, is_enterprise_telemetry_enabled

    if not is_enterprise_telemetry_enabled():
        return None
    config: dict[str, Any] = {
        "endpoint": dify_config.ENTERPRISE_OTLP_ENDPOINT,
        "protocol": dify_config.ENTERPRISE_OTLP_PROTOCOL,
        "headers": _parse_otlp_headers(dify_config.ENTERPRISE_OTLP_HEADERS),
        "api_key": dify_config.ENTERPRISE_OTLP_API_KEY,
        "service_name": dify_config.APPLICATION_NAME,
        "include_content": dify_config.ENTERPRISE_INCLUDE_CONTENT,
        "sampling_rate": dify_config.ENTERPRISE_OTEL_SAMPLING_RATE,
    }
    config["signals"] = resolve_enterprise_signal_settings(config)
    return config


def resolve_enterprise_signal_settings(provider_config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Freeze the previous SDK's destination/auth defaults before their configuration is fingerprinted."""
    if "signals" in provider_config:
        return provider_config["signals"]
    protocol = provider_config.get("protocol", "grpc")
    configured_endpoint = str(provider_config.get("endpoint") or "").rstrip("/")
    configured_headers = dict(provider_config.get("headers") or {})
    if provider_config.get("api_key"):
        configured_headers["authorization"] = f"Bearer {provider_config['api_key']}"
    signals: dict[str, dict[str, Any]] = {}
    for signal, env_signal in (("trace", "TRACES"), ("metrics", "METRICS")):
        prefix = f"OTEL_EXPORTER_OTLP_{env_signal}_"
        if configured_endpoint:
            endpoint = configured_endpoint
            if protocol != "grpc":
                endpoint += "/v1/" + ("traces" if signal == "trace" else signal)
        elif os.environ.get(prefix + "ENDPOINT"):
            endpoint = os.environ[prefix + "ENDPOINT"]
        else:
            endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or (
                "http://localhost:4317" if protocol == "grpc" else "http://localhost:4318"
            )
            if protocol != "grpc":
                endpoint = endpoint.rstrip("/") + "/v1/" + ("traces" if signal == "trace" else signal)
        if protocol == "grpc":
            if "://" not in endpoint:
                endpoint = f"http://{endpoint}"
            parsed = urlsplit(endpoint)
            if parsed.hostname and parsed.port is None:
                # The SDK passed a portless target to gRPC, whose DNS default is 443 even without TLS.
                endpoint = urlunsplit(parsed._replace(netloc=f"{parsed.netloc}:443"))
        raw_headers = os.environ.get(prefix + "HEADERS", os.environ.get("OTEL_EXPORTER_OTLP_HEADERS", ""))
        # The SDK logs rejected header text; filter it with its own grammar before parsing credentials.
        valid_headers = ",".join(
            header for header in raw_headers.split(",") if _LIBERAL_HEADER_PATTERN.fullmatch(header.strip())
        )
        headers = configured_headers or parse_env_headers(valid_headers, liberal=True)
        tls: dict[str, str] = {}
        if urlsplit(endpoint).scheme == "https":
            # gRPC selects the complete signal-specific credential set when its CA is set.
            tls_prefix = (
                prefix if protocol != "grpc" or os.environ.get(prefix + "CERTIFICATE") else "OTEL_EXPORTER_OTLP_"
            )
            for field in ("certificate", "client_key", "client_certificate"):
                if protocol == "grpc" and not os.environ.get(tls_prefix + "CERTIFICATE"):
                    break
                filename = os.environ.get(tls_prefix + field.upper())
                if protocol != "grpc" and filename is None:
                    filename = os.environ.get("OTEL_EXPORTER_OTLP_" + field.upper())
                if filename:
                    try:
                        # Contents, not mutable filenames, enter the settings HMAC and authorized export.
                        tls[field] = base64.b64encode(Path(filename).read_bytes()).decode("ascii")
                    except OSError:
                        raise ValueError("Cannot read enterprise TLS configuration") from None
        signals[signal] = {"endpoint": endpoint, "headers": dict(headers), "tls": tls}
    return signals


def create_enterprise_http_ssl_context(tls: dict[str, str]) -> ssl.SSLContext | None:
    if not tls:
        return None
    certificate = base64.b64decode(tls["certificate"]) if tls.get("certificate") else None
    context = ssl.create_default_context(
        cadata=certificate.decode("ascii") if certificate and b"-----BEGIN" in certificate else certificate
    )
    if tls.get("client_certificate"):
        # SSLContext only accepts filenames for a client chain. Private temporary files are removed after loading.
        with NamedTemporaryFile() as certificate_file, NamedTemporaryFile() as key_file:
            certificate_file.write(base64.b64decode(tls["client_certificate"]))
            certificate_file.flush()
            if tls.get("client_key"):
                key_file.write(base64.b64decode(tls["client_key"]))
                key_file.flush()
            context.load_cert_chain(certificate_file.name, key_file.name if tls.get("client_key") else None)
    return context


def business_status(span: TraceSpan, operation_type: str) -> str:
    """Keep business outcome separate from whether the trace capture is complete."""
    if span.status == "incomplete":
        return "unknown"
    if span.status == "cancelled":
        return "stopped"
    if span.status == "handled_error":
        return "partial-succeeded" if operation_type == "workflow" else "exception"
    if span.status == "error":
        return "error" if operation_type == "message" and span.attributes.get("status") == "error" else "failed"
    captured_status = span.attributes.get("business_status")
    if operation_type == "message":
        captured_status = captured_status or span.attributes.get("status")
    return str(captured_status or "succeeded")


def captured_fields(span: TraceSpan) -> dict[str, Any]:
    process_data = span.attributes.get("process_data")
    metadata = span.attributes.get("metadata")
    return {
        **(process_data if isinstance(process_data, dict) else {}),
        **(metadata if isinstance(metadata, dict) else {}),
        **span.attributes,
    }


def span_usage(span: TraceSpan) -> dict[str, Any]:
    usage = span.usage or span.attributes.get("aggregate_usage")
    return usage if isinstance(usage, dict) else {}


def elapsed_seconds(span: TraceSpan) -> float | None:
    return (span.ended_at - span.started_at).total_seconds() if span.started_at and span.ended_at else None


def invocation_source(captured: dict[str, Any], operation_type: str) -> Any:
    if operation_type == "message":
        return captured.get("from_source") or captured.get("invoke_from")
    return captured.get("triggered_from") or captured.get("invoke_from") or captured.get("from_source")


class EnterpriseTraceClient:
    def __init__(self, provider_config: dict[str, Any]):
        protocol = str(provider_config.get("protocol", "grpc"))
        signals = resolve_enterprise_signal_settings(provider_config)
        trace_settings, metrics_settings = signals["trace"], signals["metrics"]
        ssl_contexts: dict[str, ssl.SSLContext | None] = {}
        grpc_credentials: dict[str, Any] = {}
        for signal, settings in signals.items():
            tls = settings["tls"]
            if protocol == "grpc" and tls:
                import grpc  # pyrefly: ignore[untyped-import]

                grpc_credentials[signal] = grpc.ssl_channel_credentials(
                    root_certificates=base64.b64decode(tls["certificate"]) if tls.get("certificate") else None,
                    private_key=base64.b64decode(tls["client_key"]) if tls.get("client_key") else None,
                    certificate_chain=base64.b64decode(tls["client_certificate"])
                    if tls.get("client_certificate")
                    else None,
                )
            elif protocol != "grpc":
                ssl_contexts[signal] = create_enterprise_http_ssl_context(tls)
        self.otlp = OtlpTraceClient(
            trace_settings["endpoint"],
            trace_settings["headers"],
            {"service.name": provider_config.get("service_name", "dify"), "host.name": socket.gethostname()},
            "",
            protocol=protocol,
            ssl_context=ssl_contexts.get("trace"),
            metrics_http=TraceProviderHttpClient(
                metrics_settings["endpoint"], metrics_settings["headers"], ssl_context=ssl_contexts.get("metrics")
            ),
            grpc_credentials=grpc_credentials,
        )
        if protocol != "grpc":
            # Standard per-signal HTTP endpoints are exact, including a trailing slash.
            self.otlp.http.endpoint = trace_settings["endpoint"]
            assert self.otlp.metrics_http is not None
            self.otlp.metrics_http.endpoint = metrics_settings["endpoint"]
        self.include_content = bool(provider_config.get("include_content", False))
        self.sampling_rate = float(provider_config.get("sampling_rate", 1))
        self.logger = logging.getLogger("dify.telemetry")

    def _operation_type(self, span: TraceSpan) -> str:
        if span.span_type == "workflow":
            return "workflow"
        if span.attributes.get("operation_type") == "draft_node_execution":
            return "draft_node_execution"
        if span.node_execution_id:
            return "node_execution"
        operation = str(
            span.attributes.get("operation_type")
            or (span.span_name if span.span_type == "operation" else span.span_type)
        )
        return "dataset_retrieval" if operation == "retrieval" else operation

    def _attributes(self, trace: CompletedTrace, span: TraceSpan, operation_type: str) -> dict[str, Any]:
        captured = captured_fields(span)
        if operation_type == "moderation" and isinstance(span.outputs, dict):
            for field in ("flagged", "action", "query", "preset_response"):
                if field in span.outputs:
                    captured[field] = span.outputs[field]
        usage = span_usage(span)
        attributes: dict[str, Any] = span_attributes(trace, span)
        if not self.include_content:
            # Arbitrary captured attributes may include prompts. Project operational
            # fields explicitly so disabling content does not hide node identity/timing.
            safe_fields = {
                "dify.tenant_id",
                "dify.app_id",
                "dify.pipeline_id",
                "dify.workflow.id",
                "dify.workflow.version",
                "dify.workflow.run_id",
                "dify.node.execution_id",
                "dify.node.id",
                "dify.node.attempt",
                "dify.span.id",
                "dify.span.name",
                "dify.span.type",
                "dify.span.status",
                "dify.trace.complete",
                "dify.trace.truncation",
                "dify.trace.links",
                "dify.external_trace_id",
                "dify.session.id",
                "dify.user.id",
                "dify.message.id",
                "dify.conversation.id",
                "error.message",
            }
            attributes = {key: value for key, value in attributes.items() if key in safe_fields}
        status = business_status(span, operation_type)
        duration = elapsed_seconds(span)
        ttft = usage.get("time_to_first_token", captured.get("gen_ai_server_time_to_first_token"))
        attributes.update(
            {
                "dify.trace_id": trace.source.external_trace_id
                or trace.source.workflow_run_id
                or trace.source.message_id
                or trace.source.operation_id,
                "dify.app.name": captured.get("app_name"),
                "dify.workspace.name": captured.get("workspace_name"),
                "dify.invoke_from": invocation_source(captured, operation_type),
                "dify.invoked_by": captured.get("invoked_by") or trace.source.actor_id,
                "dify.tags": captured.get("tags"),
                "dify.plugin.name": captured.get("plugin_name"),
                "dify.credential.name": captured.get("credential_name"),
                "dify.credential.id": captured.get("credential_id"),
                "dify.cost.currency": usage.get("currency"),
                "dify.usage": {
                    key: value
                    for key, value in usage.items()
                    if isinstance(value, (int, float)) or key in {"currency", "total_price", "total_cost"}
                },
                "gen_ai.user.id": trace.source.actor_id,
                "gen_ai.provider.name": captured.get("model_provider") or captured.get("ls_provider"),
                "gen_ai.request.model": captured.get("model_name") or captured.get("ls_model_name"),
                "gen_ai.usage.input_tokens": usage.get("prompt_tokens"),
                "gen_ai.usage.output_tokens": usage.get("completion_tokens"),
                "gen_ai.usage.total_tokens": usage.get("total_tokens"),
            }
        )
        parent = captured.get("parent_trace_context")
        if isinstance(parent, dict):
            for source_key, key in (
                ("trace_id", "dify.parent.trace_id"),
                ("parent_node_execution_id", "dify.parent.node.execution_id"),
                ("parent_workflow_run_id", "dify.parent.workflow.run_id"),
                ("parent_app_id", "dify.parent.app.id"),
            ):
                attributes[key] = parent.get(source_key)
        if operation_type == "workflow":
            prefix = "dify.workflow"
            reference = f"ref:workflow_run_id={trace.source.workflow_run_id or trace.source.operation_id}"
            attributes.update(
                {f"{prefix}.status": status, f"{prefix}.error": span.error, f"{prefix}.elapsed_time": duration}
            )
        elif operation_type in {"node_execution", "draft_node_execution"}:
            prefix = "dify.node"
            reference = f"ref:node_execution_id={span.node_execution_id or trace.source.operation_id}"
            attributes.update(
                {
                    f"{prefix}.type": captured.get("node_type") or span.span_type,
                    f"{prefix}.title": span.span_name,
                    f"{prefix}.version": captured.get("node_version"),
                    f"{prefix}.status": status,
                    f"{prefix}.error": span.error,
                    f"{prefix}.elapsed_time": duration,
                    f"{prefix}.invoked_by": captured.get("invoked_by") or trace.source.actor_id,
                    f"{prefix}.total_price": usage.get("total_price", usage.get("total_cost")),
                    f"{prefix}.currency": usage.get("currency"),
                }
            )
            for field in (
                "index",
                "predecessor_node_id",
                "iteration_id",
                "iteration_index",
                "loop_id",
                "loop_index",
                "parallel_id",
            ):
                attributes[f"{prefix}.{field}"] = captured.get(field)
            for field in ("ids", "names"):
                if (value := captured.get(f"dataset_{field}")) is not None:
                    attributes[f"dify.dataset.{field}"] = json_text(value)
        else:
            prefix = {
                "message": "dify.message",
                "tool": "dify.tool",
                "moderation": "dify.moderation",
                "suggested_question": "dify.suggested_question",
                "dataset_retrieval": "dify.retrieval",
                "generate_name": "dify.generate_name",
            }.get(operation_type, "dify.prompt_generation")
            reference = (
                f"ref:message_id={trace.source.message_id}"
                if trace.source.message_id
                else f"ref:operation_id={trace.source.operation_id}"
            )
            attributes.update(
                {f"{prefix}.status": status, f"{prefix}.error": span.error, f"{prefix}.duration": duration}
            )
        if operation_type == "message":
            attributes.update(
                {
                    "dify.conversation.mode": captured.get("conversation_mode", captured.get("app_mode")),
                    "dify.message.from_source": captured.get("from_source"),
                    "dify.message.from_end_user_id": captured.get("from_end_user_id"),
                    "dify.message.from_account_id": captured.get("from_account_id"),
                    "dify.streaming": bool(captured.get("is_streaming_request")) or ttft is not None,
                    "dify.message.time_to_first_token": ttft,
                    "dify.message.streaming_duration": usage.get(
                        "time_to_generate", captured.get("llm_streaming_time_to_generate")
                    ),
                }
            )
        elif operation_type == "tool":
            attributes["dify.tool.name"] = captured.get("tool_name") or span.span_name
        elif operation_type == "moderation":
            attributes.update(
                {
                    "dify.moderation.type": captured.get("moderation_type", "input"),
                    "dify.moderation.flagged": captured.get("flagged"),
                    "dify.moderation.action": captured.get("action"),
                    "dify.moderation.categories": json_text(captured.get("moderation_categories", [])),
                }
            )
        elif operation_type == "suggested_question":
            questions = span.outputs.get("questions") if isinstance(span.outputs, dict) else span.outputs
            attributes["dify.suggested_question.count"] = len(questions) if isinstance(questions, list) else 0
        elif prefix == "dify.prompt_generation":
            attributes["dify.prompt_generation.operation_type"] = operation_type
            attributes["dify.prompt_generation.total_price"] = usage.get("total_price", usage.get("total_cost"))
            attributes["dify.prompt_generation.currency"] = usage.get("currency")

        def content(value: Any) -> Any:
            return value if self.include_content else reference

        attributes.update(
            {
                "input.value": json_text(span.inputs) if self.include_content else reference,
                "output.value": json_text(span.outputs) if self.include_content else reference,
                f"{prefix}.inputs": content(span.inputs),
                f"{prefix}.outputs": content(span.outputs),
            }
        )
        if operation_type == "workflow":
            query = captured.get("query")
            if query is None and isinstance(span.inputs, dict):
                query = span.inputs.get("sys.query")
            attributes["dify.workflow.query"] = content(query)
        elif operation_type in {"node_execution", "draft_node_execution"}:
            attributes["dify.node.process_data"] = content(captured.get("process_data"))
        elif operation_type == "tool":
            attributes["dify.tool.parameters"] = content(captured.get("tool_parameters"))
            attributes["dify.tool.config"] = content(captured.get("tool_config"))
        elif operation_type == "moderation":
            attributes["dify.moderation.query"] = content(captured.get("query", span.inputs))
            attributes["dify.moderation.preset_response"] = content(captured.get("preset_response"))
        elif operation_type == "suggested_question":
            attributes["dify.suggested_question.questions"] = content(span.outputs)
        elif operation_type == "dataset_retrieval":
            documents = self._documents(span)
            dataset_models = captured.get("dataset_models", captured.get("embedding_models", {}))
            dataset_models = dataset_models if isinstance(dataset_models, dict) else {}
            datasets = self._dataset_ids(documents)
            models = [dataset_models.get(dataset_id, {}) for dataset_id in datasets]
            models = [model for model in models if isinstance(model, dict)]
            attributes.update(
                {
                    "dify.dataset.id": json_text(datasets),
                    "dify.dataset.name": json_text([model.get("dataset_name", "") for model in models]),
                    "dify.dataset.embedding_providers": json_text(
                        [model.get("embedding_model_provider", "") for model in models]
                    ),
                    "dify.dataset.embedding_models": json_text([model.get("embedding_model", "") for model in models]),
                    "dify.retrieval.rerank_provider": captured.get("rerank_model_provider"),
                    "dify.retrieval.rerank_model": captured.get("rerank_model_name"),
                    "dify.retrieval.rerank_configuration": captured.get("rerank_configuration"),
                    "dify.retrieval.document_count": len(documents),
                    "dify.retrieval.query": content(span.inputs),
                    "dify.dataset.documents": content(documents),
                }
            )
        elif prefix == "dify.prompt_generation":
            attributes["dify.prompt_generation.instruction"] = content(span.inputs)
            attributes["dify.prompt_generation.output"] = content(span.outputs)
        return {key: value for key, value in attributes.items() if value is not None}

    @staticmethod
    def _documents(span: TraceSpan) -> list[Any]:
        documents = span.outputs.get("documents", []) if isinstance(span.outputs, dict) else span.outputs
        return documents if isinstance(documents, list) else []

    @staticmethod
    def _dataset_ids(documents: list[Any]) -> list[str]:
        return sorted(
            {
                str(metadata["dataset_id"])
                for document in documents
                if isinstance(document, dict)
                if isinstance(metadata := document.get("metadata"), dict) and metadata.get("dataset_id")
            }
        )

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        trace_id = otlp_trace_id(completed_trace, parent_span)
        sampled = UUID(trace_id).int / 2**128 < self.sampling_rate
        exported_spans = []
        metrics: list[Metric] = []
        for span in completed_trace.spans:
            operation_type = self._operation_type(span)
            attributes = self._attributes(completed_trace, span, operation_type)
            sends_span = completed_trace.spans[0].span_type == "workflow" or operation_type in {
                "workflow",
                "node_execution",
                "draft_node_execution",
            }
            if sends_span and sampled:
                exported_span = otlp_span(completed_trace, span, parent_span, attributes=attributes)
                exported_span.name = {
                    "workflow": "dify.workflow.run",
                    "draft_node_execution": "dify.node.execution.draft",
                }.get(operation_type, "dify.node.execution")
                exported_spans.append(exported_span)
            event_name = {
                "workflow": "dify.workflow.run",
                "message": "dify.message.run",
                "tool": "dify.tool.execution",
                "moderation": "dify.moderation.check",
                "suggested_question": "dify.suggested_question.generation",
                "dataset_retrieval": "dify.dataset.retrieval",
                "retrieval": "dify.dataset.retrieval",
                "generate_name": "dify.generate_name.execution",
                "node_execution": "dify.node.execution",
                "draft_node_execution": "dify.node.execution.draft",
            }.get(operation_type, "dify.prompt_generation.execution")
            signal = "span_detail" if sends_span else "metric_only"
            self.logger.info(
                "telemetry.%s",
                signal,
                extra={
                    "attributes": {**attributes, "dify.event.name": event_name, "dify.event.signal": signal},
                    "trace_id": UUID(trace_id).hex,
                    "span_id": span_id_bytes(export_span_id(completed_trace, span.span_id)).hex(),
                    "tenant_id": completed_trace.source.tenant_id,
                    "user_id": completed_trace.source.actor_id,
                },
            )
            if not span.attributes.get("metrics_from_parent"):
                metrics.extend(self._metrics(completed_trace, span, operation_type))
        if exported_spans:
            self.otlp.send_traces(
                ExportTraceServiceRequest(
                    resource_spans=[
                        ResourceSpans(
                            resource=self.otlp.resource,
                            scope_spans=[
                                ScopeSpans(
                                    scope=InstrumentationScope(name="dify.enterprise"),
                                    spans=exported_spans,
                                )
                            ],
                        )
                    ]
                )
            )
        self.otlp.send_metrics(metrics)
        return ExportedParentSpans(
            spans={
                span.span_id: {"trace_id": trace_id, "span_id": export_span_id(completed_trace, span.span_id)}
                for span in completed_trace.spans
            }
        )

    def _metrics(self, completed_trace: CompletedTrace, span: TraceSpan, operation_type: str) -> list[Metric]:
        captured = captured_fields(span)
        labels = {
            "tenant_id": completed_trace.source.tenant_id,
            "app_id": span.source_app_id or completed_trace.source.app_id or "",
        }
        model_labels = {
            "model_provider": captured.get("model_provider") or captured.get("ls_provider") or "",
            "model_name": captured.get("model_name") or captured.get("ls_model_name") or "",
        }
        status = business_status(span, operation_type)
        is_node = operation_type in {"node_execution", "draft_node_execution"}
        node_type = captured.get("node_type", "") if is_node else ""
        request_type = {
            "node_execution": "node",
            "draft_node_execution": "draft_node",
            "retrieval": "dataset_retrieval",
        }.get(operation_type, operation_type)
        if request_type not in {
            "workflow",
            "node",
            "draft_node",
            "message",
            "tool",
            "moderation",
            "suggested_question",
            "dataset_retrieval",
            "generate_name",
        }:
            request_type = "prompt_generation"
        token_labels = {
            **labels,
            **({"model_provider": "", "model_name": ""} if operation_type == "workflow" else model_labels),
            "operation_type": "node_execution" if is_node else operation_type,
            "node_type": node_type,
        }
        usage = span_usage(span)
        metrics: list[Metric] = []
        for field, name in (("prompt_tokens", "input"), ("completion_tokens", "output"), ("total_tokens", "total")):
            value = usage.get(field)
            if isinstance(value, int) and not isinstance(value, bool) and value > 0:
                metrics.append(counter(f"dify.tokens.{name}", value, span, token_labels))
        operation_labels: dict[str, Any] = dict(labels)
        if is_node:
            operation_labels.update({**model_labels, "node_type": node_type})
        elif request_type in {"message", "suggested_question", "prompt_generation"}:
            operation_labels.update(model_labels)
        elif request_type == "tool":
            operation_labels["tool_name"] = captured.get("tool_name") or span.span_name
        if request_type == "prompt_generation":
            operation_labels["operation_type"] = operation_type
        request_labels = {**operation_labels, "type": request_type}
        if request_type in {"workflow", "node", "draft_node", "message", "prompt_generation"}:
            request_labels["status"] = status
        if request_type in {"workflow", "message"}:
            request_labels["invoke_from"] = invocation_source(captured, operation_type) or ""
        metrics.append(counter("dify.requests.total", 1, span, request_labels))
        if span.status == "error" or (span.status == "handled_error" and operation_type != "workflow"):
            metrics.append(counter("dify.errors.total", 1, span, {**operation_labels, "type": request_type}))
        duration_name = {
            "workflow": "workflow",
            "node": "node",
            "draft_node": "node",
            "message": "message",
            "tool": "tool",
            "prompt_generation": "prompt_generation",
        }.get(request_type)
        duration = elapsed_seconds(span)
        if duration_name and duration is not None:
            duration_labels = dict(operation_labels)
            if request_type in {"workflow", "prompt_generation"}:
                duration_labels["status"] = status
            if is_node and node_type in {"tool", "knowledge-retrieval"} and captured.get("plugin_name"):
                duration_labels["plugin_name"] = captured["plugin_name"]
            metrics.append(
                histogram(
                    f"dify.{duration_name}.duration", duration, span, duration_labels, explicit_bounds=HISTOGRAM_BOUNDS
                )
            )
        ttft = usage.get(
            "time_to_first_token",
            captured.get("gen_ai_server_time_to_first_token", captured.get("gen_ai.server.time_to_first_token")),
        )
        if operation_type == "message" and isinstance(ttft, (int, float)) and not isinstance(ttft, bool):
            metrics.append(
                histogram(
                    "dify.message.time_to_first_token",
                    float(ttft),
                    span,
                    {**labels, **model_labels},
                    explicit_bounds=HISTOGRAM_BOUNDS,
                )
            )
        if operation_type in {"retrieval", "dataset_retrieval"}:
            dataset_models = captured.get("dataset_models", captured.get("embedding_models", {}))
            dataset_models = dataset_models if isinstance(dataset_models, dict) else {}
            for dataset_id in self._dataset_ids(self._documents(span)):
                model = dataset_models.get(dataset_id, {})
                model = model if isinstance(model, dict) else {}
                metrics.append(
                    counter(
                        "dify.dataset.retrievals.total",
                        1,
                        span,
                        {
                            **labels,
                            "dataset_id": dataset_id,
                            "embedding_model_provider": model.get("embedding_model_provider", ""),
                            "embedding_model": model.get("embedding_model", ""),
                            "rerank_model_provider": captured.get("rerank_model_provider", ""),
                            "rerank_model": captured.get("rerank_model_name", ""),
                        },
                    )
                )
        counter_units = {
            "dify.tokens.input": "{token}",
            "dify.tokens.output": "{token}",
            "dify.tokens.total": "{token}",
            "dify.requests.total": "{request}",
            "dify.errors.total": "{error}",
            "dify.dataset.retrievals.total": "{retrieval}",
        }
        for metric in metrics:
            if metric.name in counter_units:
                metric.unit = counter_units[metric.name]
        return metrics
