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
            if not hasattr(self.trace_client, "record_llm_duration"):
                return

            process_data = node_execution.process_data or {}
            usage = process_data.get("usage", {})
            latency_s = float(usage.get("latency", 0.0))

            if latency_s > 0:
                attributes = {
                    "provider": process_data.get("model_provider", ""),
                    "model": process_data.get("model_name", ""),
                    "span_kind": "GENERATION",
                }
                self.trace_client.record_llm_duration(latency_s, attributes)

        except Exception:
            logger.debug("[Tencent APM] Failed to record LLM metrics")

    def __del__(self):
        """Ensure proper cleanup on garbage collection."""
        try:
            if hasattr(self, "trace_client"):
                self.trace_client.shutdown()
        except Exception:
            pass
