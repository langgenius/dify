"""
Datadog trace orchestrator for Dify ops tracing.

This module coordinates trace-info dispatch, workflow node loading, and span
creation. Span payload construction lives in `span_builder.py`, while transport
and parent-child correlation live in `client.py`.
"""

import logging
from collections.abc import Sequence
from datetime import datetime

from opentelemetry.trace import Status, StatusCode
from sqlalchemy.orm import sessionmaker

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.datadog_trace.client import DatadogTraceClient
from core.ops.datadog_trace.span_builder import DatadogSpanBuilder
from core.ops.entities.config_entity import DatadogConfig
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
from core.repositories import DifyCoreRepositoryFactory
from dify_graph.entities.workflow_node_execution import WorkflowNodeExecution, WorkflowNodeExecutionStatus
from extensions.ext_database import db
from models import WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


def _datetime_to_ns(dt: datetime | None) -> int:
    if dt is None:
        dt = datetime.now()
    return int(dt.timestamp() * 1_000_000_000)


def _status_from_error(error: str | None) -> Status:
    if error:
        return Status(StatusCode.ERROR, error)
    return Status(StatusCode.OK)


def _workflow_node_status_to_otel_status(node_execution: WorkflowNodeExecution) -> Status:
    if node_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED:
        return Status(StatusCode.OK)
    if node_execution.status in (WorkflowNodeExecutionStatus.FAILED, WorkflowNodeExecutionStatus.EXCEPTION):
        return Status(StatusCode.ERROR, str(node_execution.error or "workflow node failed"))
    return Status(StatusCode.UNSET)


class DatadogDataTrace(BaseTraceInstance):
    """
    Datadog trace coordinator that converts Dify trace_info payloads into spans.
    """

    trace_client: DatadogTraceClient

    def __init__(self, datadog_config: DatadogConfig):
        super().__init__(datadog_config)
        self.trace_client = DatadogTraceClient(
            api_key=datadog_config.api_key,
            site=datadog_config.site,
            service_name=datadog_config.service_name,
        )
        self._session_factory: sessionmaker | None = None

    def trace(self, trace_info: BaseTraceInfo) -> None:
        if isinstance(trace_info, WorkflowTraceInfo):
            self.workflow_trace(trace_info)
        elif isinstance(trace_info, MessageTraceInfo):
            self.message_trace(trace_info)
        elif isinstance(trace_info, ModerationTraceInfo):
            pass  # Content moderation result (flagged/action/query), not an LLM call
        elif isinstance(trace_info, SuggestedQuestionTraceInfo):
            pass  # Re-emission of message data with suggested questions attached; would duplicate the message span
        elif isinstance(trace_info, DatasetRetrievalTraceInfo):
            self.dataset_retrieval_trace(trace_info)
        elif isinstance(trace_info, ToolTraceInfo):
            self.tool_trace(trace_info)
        elif isinstance(trace_info, GenerateNameTraceInfo):
            pass  # LLM call to auto-generate conversation title, not part of user conversation flow

    def workflow_trace(self, trace_info: WorkflowTraceInfo) -> None:
        try:
            attrs = DatadogSpanBuilder.build_workflow_attrs(trace_info)

            if trace_info.message_id:
                trace_key = f"message:{trace_info.message_id}"
            else:
                trace_key = f"workflow:{trace_info.workflow_run_id}"

            trace_id = DatadogTraceClient.compute_trace_id(trace_key)
            workflow_store_key = f"workflow:{trace_info.workflow_run_id}"
            self.trace_client.add_span(
                name="workflow",
                attributes=attrs,
                start_time_ns=_datetime_to_ns(trace_info.start_time),
                end_time_ns=_datetime_to_ns(trace_info.end_time),
                trace_id=trace_id,
                store_key=workflow_store_key,
                status=_status_from_error(trace_info.error),
            )

            self._process_workflow_nodes(trace_info, workflow_store_key, trace_id)
        except Exception:
            logger.exception("[Datadog] Failed to process workflow trace")

    def message_trace(self, trace_info: MessageTraceInfo) -> None:
        try:
            attrs = DatadogSpanBuilder.build_message_attrs(trace_info)
            trace_key = f"message:{trace_info.message_id}"
            self.trace_client.add_span(
                name="chat",
                attributes=attrs,
                start_time_ns=_datetime_to_ns(trace_info.start_time),
                end_time_ns=_datetime_to_ns(trace_info.end_time),
                trace_id=DatadogTraceClient.compute_trace_id(trace_key),
                store_key=trace_key,
                status=_status_from_error(trace_info.error),
            )
        except Exception:
            logger.exception("[Datadog] Failed to process message trace")

    def tool_trace(self, trace_info: ToolTraceInfo) -> None:
        try:
            if not trace_info.message_id:
                return

            attrs = DatadogSpanBuilder.build_tool_attrs(trace_info)
            trace_key = f"message:{trace_info.message_id}"
            self.trace_client.add_span(
                name=trace_info.tool_name,
                attributes=attrs,
                start_time_ns=_datetime_to_ns(trace_info.start_time),
                end_time_ns=_datetime_to_ns(trace_info.end_time),
                trace_id=DatadogTraceClient.compute_trace_id(trace_key),
                parent_key=trace_key,
                status=_status_from_error(trace_info.error),
            )
        except Exception:
            logger.exception("[Datadog] Failed to process tool trace")

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo) -> None:
        try:
            if not trace_info.message_id:
                return

            attrs = DatadogSpanBuilder.build_retrieval_attrs(trace_info)
            trace_key = f"message:{trace_info.message_id}"
            self.trace_client.add_span(
                name="retrieval",
                attributes=attrs,
                start_time_ns=_datetime_to_ns(trace_info.start_time),
                end_time_ns=_datetime_to_ns(trace_info.end_time),
                trace_id=DatadogTraceClient.compute_trace_id(trace_key),
                parent_key=trace_key,
                status=_status_from_error(trace_info.error),
            )
        except Exception:
            logger.exception("[Datadog] Failed to process dataset retrieval trace")

    def _process_workflow_nodes(
        self, trace_info: WorkflowTraceInfo, workflow_store_key: str, trace_id: int
    ) -> None:
        try:
            node_executions = self._get_workflow_node_executions(trace_info)

            for node_execution in node_executions:
                try:
                    attrs = DatadogSpanBuilder.build_workflow_node_attrs(node_execution, trace_info)
                    self.trace_client.add_span(
                        name=node_execution.title or node_execution.node_type,
                        attributes=attrs,
                        start_time_ns=_datetime_to_ns(node_execution.created_at),
                        end_time_ns=_datetime_to_ns(node_execution.finished_at),
                        trace_id=trace_id,
                        parent_key=workflow_store_key,
                        status=_workflow_node_status_to_otel_status(node_execution),
                    )
                except Exception:
                    logger.exception("[Datadog] Failed to process workflow node execution: %s", node_execution.id)
        except Exception:
            logger.exception("[Datadog] Failed to process workflow nodes")

    def _get_workflow_node_executions(self, trace_info: WorkflowTraceInfo) -> Sequence[WorkflowNodeExecution]:
        app_id = trace_info.metadata.get("app_id")
        if not app_id:
            raise ValueError("No app_id found in trace_info metadata")

        if self._session_factory is None:
            self._session_factory = sessionmaker(bind=db.engine)

        service_account = self.get_service_account_with_tenant(app_id)
        repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=self._session_factory,
            user=service_account,
            app_id=app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        return repository.get_by_workflow_run(workflow_run_id=trace_info.workflow_run_id)

    def api_check(self) -> bool:
        return self.trace_client.api_check()

    def get_project_url(self) -> str:
        return self.trace_client.get_project_url()

    def shutdown(self) -> None:
        try:
            if hasattr(self, "trace_client"):
                self.trace_client.shutdown()
        except Exception:
            logger.exception("[Datadog] Failed to shutdown trace client")

    def __del__(self):
        try:
            self.shutdown()
        except Exception:
            logger.debug("[Datadog] Failed to shutdown in __del__", exc_info=True)
