"""
Tencent APM tracing implementation with separated concerns
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import TencentConfig
from core.ops.entities.trace_entity import (
    BaseTraceInfo,
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.tencent_trace.client import TencentTraceClient
from core.ops.tencent_trace.entities.tencent_trace_entity import SpanData
from core.ops.tencent_trace.span_builder import TencentSpanBuilder
from core.ops.tencent_trace.utils import TencentTraceUtils
from core.repositories import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
)
from core.workflow.nodes import NodeType
from extensions.ext_database import db
from models import Account, App, TenantAccountJoin, WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


class TencentDataTrace(BaseTraceInstance):
    """
    Tencent APM trace implementation with single responsibility principle.
    Acts as a coordinator that delegates specific tasks to specialized classes.
    """

    def __init__(self, tencent_config: TencentConfig):
        super().__init__(tencent_config)
        self.trace_client = TencentTraceClient(
            service_name=tencent_config.service_name,
            endpoint=tencent_config.endpoint,
            token=tencent_config.token,
            metrics_export_interval_sec=5,
        )

    def trace(self, trace_info: BaseTraceInfo) -> None:
        """Main tracing entry point - coordinates different trace types."""
        if isinstance(trace_info, WorkflowTraceInfo):
            self.workflow_trace(trace_info)
        elif isinstance(trace_info, MessageTraceInfo):
            self.message_trace(trace_info)
        elif isinstance(trace_info, ModerationTraceInfo):
            pass
        elif isinstance(trace_info, SuggestedQuestionTraceInfo):
            self.suggested_question_trace(trace_info)
        elif isinstance(trace_info, DatasetRetrievalTraceInfo):
            self.dataset_retrieval_trace(trace_info)
        elif isinstance(trace_info, ToolTraceInfo):
            self.tool_trace(trace_info)
        elif isinstance(trace_info, GenerateNameTraceInfo):
            pass

    def api_check(self) -> bool:
        return self.trace_client.api_check()

    def get_project_url(self) -> str:
        return self.trace_client.get_project_url()

    def workflow_trace(self, trace_info: WorkflowTraceInfo) -> None:
        """Handle workflow tracing by coordinating data retrieval and span construction."""
        try:
            trace_id = TencentTraceUtils.convert_to_trace_id(trace_info.workflow_run_id)

            links = []
            if trace_info.trace_id:
                links.append(TencentTraceUtils.create_link(trace_info.trace_id))

            user_id = self._get_user_id(trace_info)

            workflow_spans = TencentSpanBuilder.build_workflow_spans(trace_info, trace_id, str(user_id), links)

            for span in workflow_spans:
                self.trace_client.add_span(span)

            self._process_workflow_nodes(trace_info, trace_id)

            # Record trace duration for entry span
            self._record_workflow_trace_duration(trace_info)

        except Exception:
            logger.exception("[Tencent APM] Failed to process workflow trace")

    def message_trace(self, trace_info: MessageTraceInfo) -> None:
        """Handle message tracing."""
        try:
            trace_id = TencentTraceUtils.convert_to_trace_id(trace_info.message_id)
            user_id = self._get_user_id(trace_info)

            links = []
            if trace_info.trace_id:
                links.append(TencentTraceUtils.create_link(trace_info.trace_id))

            message_span = TencentSpanBuilder.build_message_span(trace_info, trace_id, str(user_id), links)

            self.trace_client.add_span(message_span)

            self._record_message_llm_metrics(trace_info)

            # Record trace duration for entry span
            self._record_message_trace_duration(trace_info)

        except Exception:
            logger.exception("[Tencent APM] Failed to process message trace")

    def tool_trace(self, trace_info: ToolTraceInfo) -> None:
        """Handle tool tracing."""
        try:
            parent_span_id = None
            trace_root_id = None

            if trace_info.message_id:
                parent_span_id = TencentTraceUtils.convert_to_span_id(trace_info.message_id, "message")
                trace_root_id = trace_info.message_id

            if parent_span_id and trace_root_id:
                trace_id = TencentTraceUtils.convert_to_trace_id(trace_root_id)

                tool_span = TencentSpanBuilder.build_tool_span(trace_info, trace_id, parent_span_id)

                self.trace_client.add_span(tool_span)

        except Exception:
            logger.exception("[Tencent APM] Failed to process tool trace")

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo) -> None:
        """Handle dataset retrieval tracing."""
        try:
            parent_span_id = None
            trace_root_id = None

            if trace_info.message_id:
                parent_span_id = TencentTraceUtils.convert_to_span_id(trace_info.message_id, "message")
                trace_root_id = trace_info.message_id

            if parent_span_id and trace_root_id:
                trace_id = TencentTraceUtils.convert_to_trace_id(trace_root_id)

                retrieval_span = TencentSpanBuilder.build_retrieval_span(trace_info, trace_id, parent_span_id)

                self.trace_client.add_span(retrieval_span)

        except Exception:
            logger.exception("[Tencent APM] Failed to process dataset retrieval trace")

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo) -> None:
        """Handle suggested question tracing"""
        try:
            logger.info("[Tencent APM] Processing suggested question trace")

        except Exception:
            logger.exception("[Tencent APM] Failed to process suggested question trace")

    def _process_workflow_nodes(self, trace_info: WorkflowTraceInfo, trace_id: int) -> None:
        """Process workflow node executions."""
        try:
            workflow_span_id = TencentTraceUtils.convert_to_span_id(trace_info.workflow_run_id, "workflow")

            node_executions = self._get_workflow_node_executions(trace_info)

            for node_execution in node_executions:
                try:
                    node_span = self._build_workflow_node_span(node_execution, trace_id, trace_info, workflow_span_id)
                    if node_span:
                        self.trace_client.add_span(node_span)

                        if node_execution.node_type == NodeType.LLM:
                            self._record_llm_metrics(node_execution)
                except Exception:
                    logger.exception("[Tencent APM] Failed to process node execution: %s", node_execution.id)

        except Exception:
            logger.exception("[Tencent APM] Failed to process workflow nodes")

    def _build_workflow_node_span(
        self, node_execution: WorkflowNodeExecution, trace_id: int, trace_info: WorkflowTraceInfo, workflow_span_id: int
    ) -> SpanData | None:
        """Build span for different node types"""
        try:
            if node_execution.node_type == NodeType.LLM:
                return TencentSpanBuilder.build_workflow_llm_span(
                    trace_id, workflow_span_id, trace_info, node_execution
                )
            elif node_execution.node_type == NodeType.KNOWLEDGE_RETRIEVAL:
                return TencentSpanBuilder.build_workflow_retrieval_span(
                    trace_id, workflow_span_id, trace_info, node_execution
                )
            elif node_execution.node_type == NodeType.TOOL:
                return TencentSpanBuilder.build_workflow_tool_span(
                    trace_id, workflow_span_id, trace_info, node_execution
                )
            else:
                # Handle all other node types as generic tasks
                return TencentSpanBuilder.build_workflow_task_span(
                    trace_id, workflow_span_id, trace_info, node_execution
                )
        except Exception:
            logger.debug(
                "[Tencent APM] Error building span for node %s: %s",
                node_execution.id,
                node_execution.node_type,
                exc_info=True,
            )
            return None

    def _get_workflow_node_executions(self, trace_info: WorkflowTraceInfo) -> list[WorkflowNodeExecution]:
        """Retrieve workflow node executions from database."""
        try:
            session_maker = sessionmaker(bind=db.engine)

            with Session(db.engine, expire_on_commit=False) as session:
                app_id = trace_info.metadata.get("app_id")
                if not app_id:
                    raise ValueError("No app_id found in trace_info metadata")

                app_stmt = select(App).where(App.id == app_id)
                app = session.scalar(app_stmt)
                if not app:
                    raise ValueError(f"App with id {app_id} not found")

                if not app.created_by:
                    raise ValueError(f"App with id {app_id} has no creator")

                account_stmt = select(Account).where(Account.id == app.created_by)
                service_account = session.scalar(account_stmt)
                if not service_account:
                    raise ValueError(f"Creator account not found for app {app_id}")

                current_tenant = (
                    session.query(TenantAccountJoin).filter_by(account_id=service_account.id, current=True).first()
                )
                if not current_tenant:
                    raise ValueError(f"Current tenant not found for account {service_account.id}")

                service_account.set_tenant_id(current_tenant.tenant_id)

            repository = SQLAlchemyWorkflowNodeExecutionRepository(
                session_factory=session_maker,
                user=service_account,
                app_id=trace_info.metadata.get("app_id"),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )

            executions = repository.get_by_workflow_run(workflow_run_id=trace_info.workflow_run_id)
            return list(executions)

        except Exception:
            logger.exception("[Tencent APM] Failed to get workflow node executions")
            return []

    def _get_user_id(self, trace_info: BaseTraceInfo) -> str:
        """Get user ID from trace info."""
        try:
            tenant_id = None
            user_id = None

            if isinstance(trace_info, (WorkflowTraceInfo, GenerateNameTraceInfo)):
                tenant_id = trace_info.tenant_id

            if hasattr(trace_info, "metadata") and trace_info.metadata:
                user_id = trace_info.metadata.get("user_id")

            if user_id and tenant_id:
                stmt = (
                    select(Account.name)
                    .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
                    .where(Account.id == user_id, TenantAccountJoin.tenant_id == tenant_id)
                )

                session_maker = sessionmaker(bind=db.engine)
                with session_maker() as session:
                    account_name = session.scalar(stmt)
                    return account_name or str(user_id)
            elif user_id:
                return str(user_id)

            return "anonymous"

        except Exception:
            logger.exception("[Tencent APM] Failed to get user ID")
            return "unknown"

    def _record_llm_metrics(self, node_execution: WorkflowNodeExecution) -> None:
        """Record LLM performance metrics"""
        try:
            process_data = node_execution.process_data or {}
            outputs = node_execution.outputs or {}
            usage = process_data.get("usage", {}) if "usage" in process_data else outputs.get("usage", {})

            model_provider = process_data.get("model_provider", "unknown")
            model_name = process_data.get("model_name", "unknown")
            model_mode = process_data.get("model_mode", "chat")

            # Record LLM duration
            if hasattr(self.trace_client, "record_llm_duration"):
                latency_s = float(usage.get("latency", 0.0))

                if latency_s > 0:
                    # Determine if streaming from usage metrics
                    is_streaming = usage.get("time_to_first_token") is not None

                    attributes = {
                        "gen_ai.system": model_provider,
                        "gen_ai.response.model": model_name,
                        "gen_ai.operation.name": model_mode,
                        "stream": "true" if is_streaming else "false",
                    }
                    self.trace_client.record_llm_duration(latency_s, attributes)

            # Record streaming metrics from usage
            time_to_first_token = usage.get("time_to_first_token")
            if time_to_first_token is not None and hasattr(self.trace_client, "record_time_to_first_token"):
                ttft_seconds = float(time_to_first_token)
                if ttft_seconds > 0:
                    self.trace_client.record_time_to_first_token(
                        ttft_seconds=ttft_seconds, provider=model_provider, model=model_name, operation_name=model_mode
                    )

            time_to_generate = usage.get("time_to_generate")
            if time_to_generate is not None and hasattr(self.trace_client, "record_time_to_generate"):
                ttg_seconds = float(time_to_generate)
                if ttg_seconds > 0:
                    self.trace_client.record_time_to_generate(
                        ttg_seconds=ttg_seconds, provider=model_provider, model=model_name, operation_name=model_mode
                    )

            # Record token usage
            if hasattr(self.trace_client, "record_token_usage"):
                # Extract token counts
                input_tokens = int(usage.get("prompt_tokens", 0))
                output_tokens = int(usage.get("completion_tokens", 0))

                if input_tokens > 0 or output_tokens > 0:
                    server_address = f"{model_provider}"

                    # Record input tokens
                    if input_tokens > 0:
                        self.trace_client.record_token_usage(
                            token_count=input_tokens,
                            token_type="input",
                            operation_name=model_mode,
                            request_model=model_name,
                            response_model=model_name,
                            server_address=server_address,
                            provider=model_provider,
                        )

                    # Record output tokens
                    if output_tokens > 0:
                        self.trace_client.record_token_usage(
                            token_count=output_tokens,
                            token_type="output",
                            operation_name=model_mode,
                            request_model=model_name,
                            response_model=model_name,
                            server_address=server_address,
                            provider=model_provider,
                        )

        except Exception:
            logger.debug("[Tencent APM] Failed to record LLM metrics")

    def _record_message_llm_metrics(self, trace_info: MessageTraceInfo) -> None:
        """Record LLM metrics for message traces"""
        try:
            trace_metadata = trace_info.metadata or {}
            message_data = trace_info.message_data or {}
            provider_latency = 0.0
            if isinstance(message_data, dict):
                provider_latency = float(message_data.get("provider_response_latency", 0.0) or 0.0)
            else:
                provider_latency = float(getattr(message_data, "provider_response_latency", 0.0) or 0.0)

            model_provider = trace_metadata.get("ls_provider") or (
                message_data.get("model_provider", "") if isinstance(message_data, dict) else ""
            )
            model_name = trace_metadata.get("ls_model_name") or (
                message_data.get("model_id", "") if isinstance(message_data, dict) else ""
            )

            # Record LLM duration
            if provider_latency > 0 and hasattr(self.trace_client, "record_llm_duration"):
                is_streaming = trace_info.is_streaming_request

                duration_attributes = {
                    "gen_ai.system": model_provider,
                    "gen_ai.response.model": model_name,
                    "gen_ai.operation.name": "chat",  # Message traces are always chat
                    "stream": "true" if is_streaming else "false",
                }
                self.trace_client.record_llm_duration(provider_latency, duration_attributes)

            # Record streaming metrics for message traces
            if trace_info.is_streaming_request:
                # Record time to first token
                if trace_info.gen_ai_server_time_to_first_token is not None and hasattr(
                    self.trace_client, "record_time_to_first_token"
                ):
                    ttft_seconds = float(trace_info.gen_ai_server_time_to_first_token)
                    if ttft_seconds > 0:
                        self.trace_client.record_time_to_first_token(
                            ttft_seconds=ttft_seconds, provider=str(model_provider or ""), model=str(model_name or "")
                        )

                # Record time to generate
                if trace_info.llm_streaming_time_to_generate is not None and hasattr(
                    self.trace_client, "record_time_to_generate"
                ):
                    ttg_seconds = float(trace_info.llm_streaming_time_to_generate)
                    if ttg_seconds > 0:
                        self.trace_client.record_time_to_generate(
                            ttg_seconds=ttg_seconds, provider=str(model_provider or ""), model=str(model_name or "")
                        )

            # Record token usage
            if hasattr(self.trace_client, "record_token_usage"):
                input_tokens = int(trace_info.message_tokens or 0)
                output_tokens = int(trace_info.answer_tokens or 0)

                if input_tokens > 0:
                    self.trace_client.record_token_usage(
                        token_count=input_tokens,
                        token_type="input",
                        operation_name="chat",
                        request_model=str(model_name or ""),
                        response_model=str(model_name or ""),
                        server_address=str(model_provider or ""),
                        provider=str(model_provider or ""),
                    )

                if output_tokens > 0:
                    self.trace_client.record_token_usage(
                        token_count=output_tokens,
                        token_type="output",
                        operation_name="chat",
                        request_model=str(model_name or ""),
                        response_model=str(model_name or ""),
                        server_address=str(model_provider or ""),
                        provider=str(model_provider or ""),
                    )

        except Exception:
            logger.debug("[Tencent APM] Failed to record message LLM metrics")

    def _record_workflow_trace_duration(self, trace_info: WorkflowTraceInfo) -> None:
        """Record end-to-end workflow trace duration."""
        try:
            if not hasattr(self.trace_client, "record_trace_duration"):
                return

            # Calculate duration from start_time and end_time to match span duration
            if trace_info.start_time and trace_info.end_time:
                duration_s = (trace_info.end_time - trace_info.start_time).total_seconds()
            else:
                # Fallback to workflow_run_elapsed_time if timestamps not available
                duration_s = float(trace_info.workflow_run_elapsed_time)

            if duration_s > 0:
                attributes = {
                    "conversation_mode": "workflow",
                    "workflow_status": trace_info.workflow_run_status,
                }

                # Add conversation_id if available
                if trace_info.conversation_id:
                    attributes["has_conversation"] = "true"
                else:
                    attributes["has_conversation"] = "false"

                self.trace_client.record_trace_duration(duration_s, attributes)

        except Exception:
            logger.debug("[Tencent APM] Failed to record workflow trace duration")

    def _record_message_trace_duration(self, trace_info: MessageTraceInfo) -> None:
        """Record end-to-end message trace duration."""
        try:
            if not hasattr(self.trace_client, "record_trace_duration"):
                return

            # Calculate duration from start_time and end_time
            if trace_info.start_time and trace_info.end_time:
                duration = (trace_info.end_time - trace_info.start_time).total_seconds()

                if duration > 0:
                    attributes = {
                        "conversation_mode": trace_info.conversation_mode,
                    }

                    # Add streaming flag if available
                    if hasattr(trace_info, "is_streaming_request"):
                        attributes["stream"] = "true" if trace_info.is_streaming_request else "false"

                    self.trace_client.record_trace_duration(duration, attributes)

        except Exception:
            logger.debug("[Tencent APM] Failed to record message trace duration")

    def __del__(self):
        """Ensure proper cleanup on garbage collection."""
        try:
            if hasattr(self, "trace_client"):
                self.trace_client.shutdown()
        except Exception:
            pass
