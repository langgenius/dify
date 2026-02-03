"""Enterprise trace handler — duck-typed, NOT a BaseTraceInstance subclass.

Invoked directly in the Celery task, not through OpsTraceManager dispatch.
Only requires a matching ``trace(trace_info)`` method signature.

Signal strategy:
- **Traces (spans)**: workflow run, node execution, draft node execution only.
- **Metrics + structured logs**: all other event types.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from core.ops.entities.trace_entity import (
    BaseTraceInfo,
    DatasetRetrievalTraceInfo,
    DraftNodeExecutionTrace,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowNodeTraceInfo,
    WorkflowTraceInfo,
)
from enterprise.telemetry.entities import (
    EnterpriseTelemetryCounter,
    EnterpriseTelemetryHistogram,
    EnterpriseTelemetrySpan,
)
from enterprise.telemetry.telemetry_log import emit_metric_only_event, emit_telemetry_log

logger = logging.getLogger(__name__)


class EnterpriseOtelTrace:
    """Duck-typed enterprise trace handler.

    ``*_trace`` methods emit spans (workflow/node only) or structured logs
    (all other events), plus metrics at 100 % accuracy.
    """

    def __init__(self) -> None:
        from extensions.ext_enterprise_telemetry import get_enterprise_exporter

        exporter = get_enterprise_exporter()
        if exporter is None:
            raise RuntimeError("EnterpriseOtelTrace instantiated but exporter is not initialized")
        self._exporter = exporter

    def trace(self, trace_info: BaseTraceInfo) -> None:
        if isinstance(trace_info, WorkflowTraceInfo):
            self._workflow_trace(trace_info)
        elif isinstance(trace_info, MessageTraceInfo):
            self._message_trace(trace_info)
        elif isinstance(trace_info, ToolTraceInfo):
            self._tool_trace(trace_info)
        elif isinstance(trace_info, DraftNodeExecutionTrace):
            self._draft_node_execution_trace(trace_info)
        elif isinstance(trace_info, WorkflowNodeTraceInfo):
            self._node_execution_trace(trace_info)
        elif isinstance(trace_info, ModerationTraceInfo):
            self._moderation_trace(trace_info)
        elif isinstance(trace_info, SuggestedQuestionTraceInfo):
            self._suggested_question_trace(trace_info)
        elif isinstance(trace_info, DatasetRetrievalTraceInfo):
            self._dataset_retrieval_trace(trace_info)
        elif isinstance(trace_info, GenerateNameTraceInfo):
            self._generate_name_trace(trace_info)

    def _common_attrs(self, trace_info: BaseTraceInfo) -> dict[str, Any]:
        return {
            "dify.trace_id": trace_info.trace_id,
            "dify.tenant_id": trace_info.metadata.get("tenant_id"),
            "dify.app_id": trace_info.metadata.get("app_id"),
            "dify.app.name": trace_info.metadata.get("app_name"),
            "dify.workspace.name": trace_info.metadata.get("workspace_name"),
            "gen_ai.user.id": trace_info.metadata.get("user_id"),
            "dify.message.id": trace_info.message_id,
        }

    def _maybe_json(self, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        try:
            return json.dumps(value, default=str)
        except (TypeError, ValueError):
            return str(value)

    # ------------------------------------------------------------------
    # SPAN-emitting handlers (workflow, node execution, draft node)
    # ------------------------------------------------------------------

    def _workflow_trace(self, info: WorkflowTraceInfo) -> None:
        # -- Slim span attrs: identity + structure + status + timing only --
        span_attrs: dict[str, Any] = {
            "dify.trace_id": info.trace_id,
            "dify.tenant_id": info.metadata.get("tenant_id"),
            "dify.app_id": info.metadata.get("app_id"),
            "dify.workflow.id": info.workflow_id,
            "dify.workflow.run_id": info.workflow_run_id,
            "dify.workflow.status": info.workflow_run_status,
            "dify.workflow.error": info.error,
            "dify.workflow.elapsed_time": info.workflow_run_elapsed_time,
            "dify.invoke_from": info.metadata.get("triggered_from"),
            "dify.conversation.id": info.conversation_id,
            "dify.message.id": info.message_id,
            "dify.invoked_by": info.invoked_by,
        }

        trace_correlation_override: str | None = None
        parent_span_id_source: str | None = None

        parent_ctx = info.metadata.get("parent_trace_context")
        if parent_ctx and isinstance(parent_ctx, dict):
            span_attrs["dify.parent.trace_id"] = parent_ctx.get("trace_id")
            span_attrs["dify.parent.node.execution_id"] = parent_ctx.get("parent_node_execution_id")
            span_attrs["dify.parent.workflow.run_id"] = parent_ctx.get("parent_workflow_run_id")
            span_attrs["dify.parent.app.id"] = parent_ctx.get("parent_app_id")

            trace_correlation_override = parent_ctx.get("parent_workflow_run_id")
            parent_span_id_source = parent_ctx.get("parent_node_execution_id")

        self._exporter.export_span(
            EnterpriseTelemetrySpan.WORKFLOW_RUN,
            span_attrs,
            correlation_id=info.workflow_run_id,
            span_id_source=info.workflow_run_id,
            start_time=info.start_time,
            end_time=info.end_time,
            trace_correlation_override=trace_correlation_override,
            parent_span_id_source=parent_span_id_source,
        )

        # -- Companion log: ALL attrs (span + detail) for full picture --
        log_attrs: dict[str, Any] = {**span_attrs}
        log_attrs.update(
            {
                "dify.app.name": info.metadata.get("app_name"),
                "dify.workspace.name": info.metadata.get("workspace_name"),
                "gen_ai.user.id": info.metadata.get("user_id"),
                "gen_ai.usage.total_tokens": info.total_tokens,
                "dify.workflow.version": info.workflow_run_version,
            }
        )

        if self._exporter.include_content:
            log_attrs["dify.workflow.inputs"] = self._maybe_json(info.workflow_run_inputs)
            log_attrs["dify.workflow.outputs"] = self._maybe_json(info.workflow_run_outputs)
            log_attrs["dify.workflow.query"] = info.query
        else:
            ref = f"ref:workflow_run_id={info.workflow_run_id}"
            log_attrs["dify.workflow.inputs"] = ref
            log_attrs["dify.workflow.outputs"] = ref
            log_attrs["dify.workflow.query"] = ref

        emit_telemetry_log(
            event_name="dify.workflow.run",
            attributes=log_attrs,
            signal="span_detail",
            trace_id_source=info.workflow_run_id,
            span_id_source=info.workflow_run_id,
            tenant_id=info.metadata.get("tenant_id"),
            user_id=info.metadata.get("user_id"),
        )

        # -- Metrics --
        labels = {
            "tenant_id": info.tenant_id,
            "app_id": info.metadata.get("app_id", ""),
        }
        self._exporter.increment_counter(EnterpriseTelemetryCounter.TOKENS, info.total_tokens, labels)
        invoke_from = info.metadata.get("triggered_from", "")
        self._exporter.increment_counter(
            EnterpriseTelemetryCounter.REQUESTS,
            1,
            {**labels, "type": "workflow", "status": info.workflow_run_status, "invoke_from": invoke_from},
        )
        self._exporter.record_histogram(
            EnterpriseTelemetryHistogram.WORKFLOW_DURATION,
            float(info.workflow_run_elapsed_time),
            {**labels, "status": info.workflow_run_status},
        )

        if info.error:
            self._exporter.increment_counter(EnterpriseTelemetryCounter.ERRORS, 1, {**labels, "type": "workflow"})

    def _node_execution_trace(self, info: WorkflowNodeTraceInfo) -> None:
        self._emit_node_execution_trace(info, EnterpriseTelemetrySpan.NODE_EXECUTION, "node")

    def _draft_node_execution_trace(self, info: DraftNodeExecutionTrace) -> None:
        self._emit_node_execution_trace(
            info,
            EnterpriseTelemetrySpan.DRAFT_NODE_EXECUTION,
            "draft_node",
            correlation_id_override=info.node_execution_id,
            trace_correlation_override_param=info.workflow_run_id,
        )

    def _emit_node_execution_trace(
        self,
        info: WorkflowNodeTraceInfo,
        span_name: EnterpriseTelemetrySpan,
        request_type: str,
        correlation_id_override: str | None = None,
        trace_correlation_override_param: str | None = None,
    ) -> None:
        # -- Slim span attrs: identity + structure + status + timing --
        span_attrs: dict[str, Any] = {
            "dify.trace_id": info.trace_id,
            "dify.tenant_id": info.tenant_id,
            "dify.app_id": info.metadata.get("app_id"),
            "dify.workflow.id": info.workflow_id,
            "dify.workflow.run_id": info.workflow_run_id,
            "dify.message.id": info.message_id,
            "dify.conversation.id": info.metadata.get("conversation_id"),
            "dify.node.execution_id": info.node_execution_id,
            "dify.node.id": info.node_id,
            "dify.node.type": info.node_type,
            "dify.node.title": info.title,
            "dify.node.status": info.status,
            "dify.node.error": info.error,
            "dify.node.elapsed_time": info.elapsed_time,
            "dify.node.index": info.index,
            "dify.node.predecessor_node_id": info.predecessor_node_id,
            "dify.node.iteration_id": info.iteration_id,
            "dify.node.loop_id": info.loop_id,
            "dify.node.parallel_id": info.parallel_id,
            "dify.node.invoked_by": info.invoked_by,
        }

        trace_correlation_override = trace_correlation_override_param
        parent_ctx = info.metadata.get("parent_trace_context")
        if parent_ctx and isinstance(parent_ctx, dict):
            trace_correlation_override = parent_ctx.get("parent_workflow_run_id") or trace_correlation_override

        effective_correlation_id = correlation_id_override or info.workflow_run_id
        self._exporter.export_span(
            span_name,
            span_attrs,
            correlation_id=effective_correlation_id,
            span_id_source=info.node_execution_id,
            start_time=info.start_time,
            end_time=info.end_time,
            trace_correlation_override=trace_correlation_override,
        )

        # -- Companion log: ALL attrs (span + detail) --
        log_attrs: dict[str, Any] = {**span_attrs}
        log_attrs.update(
            {
                "dify.app.name": info.metadata.get("app_name"),
                "dify.workspace.name": info.metadata.get("workspace_name"),
                "dify.invoke_from": info.metadata.get("invoke_from"),
                "gen_ai.user.id": info.metadata.get("user_id"),
                "gen_ai.usage.total_tokens": info.total_tokens,
                "dify.node.total_price": info.total_price,
                "dify.node.currency": info.currency,
                "gen_ai.provider.name": info.model_provider,
                "gen_ai.request.model": info.model_name,
                "gen_ai.usage.input_tokens": info.prompt_tokens,
                "gen_ai.usage.output_tokens": info.completion_tokens,
                "gen_ai.tool.name": info.tool_name,
                "dify.node.iteration_index": info.iteration_index,
                "dify.node.loop_index": info.loop_index,
                "dify.plugin.name": info.metadata.get("plugin_name"),
                "dify.credential.name": info.metadata.get("credential_name"),
                "dify.dataset.ids": self._maybe_json(info.metadata.get("dataset_ids")),
                "dify.dataset.names": self._maybe_json(info.metadata.get("dataset_names")),
            }
        )

        if self._exporter.include_content:
            log_attrs["dify.node.inputs"] = self._maybe_json(info.node_inputs)
            log_attrs["dify.node.outputs"] = self._maybe_json(info.node_outputs)
            log_attrs["dify.node.process_data"] = self._maybe_json(info.process_data)
        else:
            ref = f"ref:node_execution_id={info.node_execution_id}"
            log_attrs["dify.node.inputs"] = ref
            log_attrs["dify.node.outputs"] = ref
            log_attrs["dify.node.process_data"] = ref

        emit_telemetry_log(
            event_name=span_name.value,
            attributes=log_attrs,
            signal="span_detail",
            trace_id_source=info.workflow_run_id,
            span_id_source=info.node_execution_id,
            tenant_id=info.tenant_id,
            user_id=info.metadata.get("user_id"),
        )

        # -- Metrics --
        labels = {
            "tenant_id": info.tenant_id,
            "app_id": info.metadata.get("app_id", ""),
            "node_type": info.node_type,
            "model_provider": info.model_provider or "",
        }
        if info.total_tokens:
            token_labels = {**labels, "model_name": info.model_name or ""}
            self._exporter.increment_counter(EnterpriseTelemetryCounter.TOKENS, info.total_tokens, token_labels)
        self._exporter.increment_counter(
            EnterpriseTelemetryCounter.REQUESTS, 1, {**labels, "type": request_type, "status": info.status}
        )
        duration_labels = dict(labels)
        plugin_name = info.metadata.get("plugin_name")
        if plugin_name and info.node_type in {"tool", "knowledge-retrieval"}:
            duration_labels["plugin_name"] = plugin_name
        self._exporter.record_histogram(EnterpriseTelemetryHistogram.NODE_DURATION, info.elapsed_time, duration_labels)

        if info.error:
            self._exporter.increment_counter(EnterpriseTelemetryCounter.ERRORS, 1, {**labels, "type": request_type})

    # ------------------------------------------------------------------
    # METRIC-ONLY handlers (structured log + counters/histograms)
    # ------------------------------------------------------------------

    def _message_trace(self, info: MessageTraceInfo) -> None:
        attrs = self._common_attrs(info)
        attrs.update(
            {
                "dify.invoke_from": info.metadata.get("from_source"),
                "dify.conversation.id": info.metadata.get("conversation_id"),
                "dify.conversation.mode": info.conversation_mode,
                "gen_ai.provider.name": info.metadata.get("ls_provider"),
                "gen_ai.request.model": info.metadata.get("ls_model_name"),
                "gen_ai.usage.input_tokens": info.message_tokens,
                "gen_ai.usage.output_tokens": info.answer_tokens,
                "gen_ai.usage.total_tokens": info.total_tokens,
                "dify.message.status": info.metadata.get("status"),
                "dify.message.error": info.error,
                "dify.message.from_source": info.metadata.get("from_source"),
                "dify.message.from_end_user_id": info.metadata.get("from_end_user_id"),
                "dify.message.from_account_id": info.metadata.get("from_account_id"),
                "dify.streaming": info.is_streaming_request,
                "dify.message.time_to_first_token": info.gen_ai_server_time_to_first_token,
                "dify.message.streaming_duration": info.llm_streaming_time_to_generate,
                "dify.workflow.run_id": info.metadata.get("workflow_run_id"),
            }
        )

        if self._exporter.include_content:
            attrs["dify.message.inputs"] = self._maybe_json(info.inputs)
            attrs["dify.message.outputs"] = self._maybe_json(info.outputs)
        else:
            ref = f"ref:message_id={info.message_id}"
            attrs["dify.message.inputs"] = ref
            attrs["dify.message.outputs"] = ref

        emit_metric_only_event(
            event_name="dify.message.run",
            attributes=attrs,
            trace_id_source=info.metadata.get("workflow_run_id") or str(info.message_id) if info.message_id else None,
            tenant_id=info.metadata.get("tenant_id"),
            user_id=info.metadata.get("user_id"),
        )

        labels = {
            "tenant_id": info.metadata.get("tenant_id", ""),
            "app_id": info.metadata.get("app_id", ""),
            "model_provider": info.metadata.get("ls_provider", ""),
            "model_name": info.metadata.get("ls_model_name", ""),
        }
        self._exporter.increment_counter(EnterpriseTelemetryCounter.TOKENS, info.total_tokens, labels)
        invoke_from = info.metadata.get("from_source", "")
        self._exporter.increment_counter(
            EnterpriseTelemetryCounter.REQUESTS,
            1,
            {**labels, "type": "message", "status": info.metadata.get("status", ""), "invoke_from": invoke_from},
        )

        if info.start_time and info.end_time:
            duration = (info.end_time - info.start_time).total_seconds()
            self._exporter.record_histogram(EnterpriseTelemetryHistogram.MESSAGE_DURATION, duration, labels)

        if info.gen_ai_server_time_to_first_token is not None:
            self._exporter.record_histogram(
                EnterpriseTelemetryHistogram.MESSAGE_TTFT, info.gen_ai_server_time_to_first_token, labels
            )

        if info.error:
            self._exporter.increment_counter(EnterpriseTelemetryCounter.ERRORS, 1, {**labels, "type": "message"})

    def _tool_trace(self, info: ToolTraceInfo) -> None:
        attrs = self._common_attrs(info)
        attrs.update(
            {
                "gen_ai.tool.name": info.tool_name,
                "dify.tool.time_cost": info.time_cost,
                "dify.tool.error": info.error,
            }
        )

        if self._exporter.include_content:
            attrs["dify.tool.inputs"] = self._maybe_json(info.tool_inputs)
            attrs["dify.tool.outputs"] = info.tool_outputs
            attrs["dify.tool.parameters"] = self._maybe_json(info.tool_parameters)
            attrs["dify.tool.config"] = self._maybe_json(info.tool_config)
        else:
            ref = f"ref:message_id={info.message_id}"
            attrs["dify.tool.inputs"] = ref
            attrs["dify.tool.outputs"] = ref
            attrs["dify.tool.parameters"] = ref
            attrs["dify.tool.config"] = ref

        emit_metric_only_event(
            event_name="dify.tool.execution",
            attributes=attrs,
            tenant_id=info.metadata.get("tenant_id"),
            user_id=info.metadata.get("user_id"),
        )

        labels = {
            "tenant_id": info.metadata.get("tenant_id", ""),
            "app_id": info.metadata.get("app_id", ""),
            "tool_name": info.tool_name,
        }
        self._exporter.increment_counter(EnterpriseTelemetryCounter.REQUESTS, 1, {**labels, "type": "tool"})
        self._exporter.record_histogram(EnterpriseTelemetryHistogram.TOOL_DURATION, float(info.time_cost), labels)

        if info.error:
            self._exporter.increment_counter(EnterpriseTelemetryCounter.ERRORS, 1, {**labels, "type": "tool"})

    def _moderation_trace(self, info: ModerationTraceInfo) -> None:
        attrs = self._common_attrs(info)
        attrs.update(
            {
                "dify.moderation.flagged": info.flagged,
                "dify.moderation.action": info.action,
                "dify.moderation.preset_response": info.preset_response,
            }
        )

        if self._exporter.include_content:
            attrs["dify.moderation.query"] = info.query
        else:
            attrs["dify.moderation.query"] = f"ref:message_id={info.message_id}"

        emit_metric_only_event(
            event_name="dify.moderation.check",
            attributes=attrs,
            tenant_id=info.metadata.get("tenant_id"),
            user_id=info.metadata.get("user_id"),
        )

        labels = {"tenant_id": info.metadata.get("tenant_id", ""), "app_id": info.metadata.get("app_id", "")}
        self._exporter.increment_counter(EnterpriseTelemetryCounter.REQUESTS, 1, {**labels, "type": "moderation"})

    def _suggested_question_trace(self, info: SuggestedQuestionTraceInfo) -> None:
        attrs = self._common_attrs(info)
        attrs.update(
            {
                "gen_ai.usage.total_tokens": info.total_tokens,
                "dify.suggested_question.status": info.status,
                "dify.suggested_question.error": info.error,
                "gen_ai.provider.name": info.model_provider,
                "gen_ai.request.model": info.model_id,
                "dify.suggested_question.count": len(info.suggested_question),
            }
        )

        if self._exporter.include_content:
            attrs["dify.suggested_question.questions"] = self._maybe_json(info.suggested_question)
        else:
            attrs["dify.suggested_question.questions"] = f"ref:message_id={info.message_id}"

        emit_metric_only_event(
            event_name="dify.suggested_question.generation",
            attributes=attrs,
            tenant_id=info.metadata.get("tenant_id"),
            user_id=info.metadata.get("user_id"),
        )

        labels = {"tenant_id": info.metadata.get("tenant_id", ""), "app_id": info.metadata.get("app_id", "")}
        self._exporter.increment_counter(
            EnterpriseTelemetryCounter.REQUESTS, 1, {**labels, "type": "suggested_question"}
        )

    def _dataset_retrieval_trace(self, info: DatasetRetrievalTraceInfo) -> None:
        attrs = self._common_attrs(info)
        attrs["dify.dataset.error"] = info.error

        docs = info.documents or []
        dataset_ids: list[str] = []
        dataset_names: list[str] = []
        structured_docs: list[dict] = []
        for doc in docs:
            meta = doc.get("metadata", {}) if isinstance(doc, dict) else {}
            did = meta.get("dataset_id")
            dname = meta.get("dataset_name")
            if did and did not in dataset_ids:
                dataset_ids.append(did)
            if dname and dname not in dataset_names:
                dataset_names.append(dname)
            structured_docs.append(
                {
                    "dataset_id": did,
                    "document_id": meta.get("document_id"),
                    "segment_id": meta.get("segment_id"),
                    "score": meta.get("score"),
                }
            )

        attrs["dify.dataset.ids"] = self._maybe_json(dataset_ids)
        attrs["dify.dataset.names"] = self._maybe_json(dataset_names)
        attrs["dify.retrieval.document_count"] = len(docs)

        embedding_models = info.metadata.get("embedding_models") or {}
        if isinstance(embedding_models, dict):
            providers: list[str] = []
            models: list[str] = []
            for ds_info in embedding_models.values():
                if isinstance(ds_info, dict):
                    p = ds_info.get("embedding_model_provider", "")
                    m = ds_info.get("embedding_model", "")
                    if p and p not in providers:
                        providers.append(p)
                    if m and m not in models:
                        models.append(m)
            attrs["dify.dataset.embedding_providers"] = self._maybe_json(providers)
            attrs["dify.dataset.embedding_models"] = self._maybe_json(models)

        if self._exporter.include_content:
            attrs["dify.retrieval.query"] = self._maybe_json(info.inputs)
            attrs["dify.dataset.documents"] = self._maybe_json(structured_docs)
        else:
            ref = f"ref:message_id={info.message_id}"
            attrs["dify.retrieval.query"] = ref
            attrs["dify.dataset.documents"] = ref

        emit_metric_only_event(
            event_name="dify.dataset.retrieval",
            attributes=attrs,
            tenant_id=info.metadata.get("tenant_id"),
            user_id=info.metadata.get("user_id"),
        )

        labels = {"tenant_id": info.metadata.get("tenant_id", ""), "app_id": info.metadata.get("app_id", "")}
        self._exporter.increment_counter(
            EnterpriseTelemetryCounter.REQUESTS, 1, {**labels, "type": "dataset_retrieval"}
        )

        for did in dataset_ids:
            self._exporter.increment_counter(
                EnterpriseTelemetryCounter.DATASET_RETRIEVALS, 1, {**labels, "dataset_id": did}
            )

    def _generate_name_trace(self, info: GenerateNameTraceInfo) -> None:
        attrs = self._common_attrs(info)
        attrs["dify.conversation.id"] = info.conversation_id

        if self._exporter.include_content:
            attrs["dify.generate_name.inputs"] = self._maybe_json(info.inputs)
            attrs["dify.generate_name.outputs"] = self._maybe_json(info.outputs)
        else:
            ref = f"ref:conversation_id={info.conversation_id}"
            attrs["dify.generate_name.inputs"] = ref
            attrs["dify.generate_name.outputs"] = ref

        emit_metric_only_event(
            event_name="dify.generate_name.execution",
            attributes=attrs,
            tenant_id=info.tenant_id,
            user_id=info.metadata.get("user_id"),
        )

        labels = {"tenant_id": info.tenant_id, "app_id": info.metadata.get("app_id", "")}
        self._exporter.increment_counter(EnterpriseTelemetryCounter.REQUESTS, 1, {**labels, "type": "generate_name"})
