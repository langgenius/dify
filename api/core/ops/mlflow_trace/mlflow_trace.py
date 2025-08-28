import json
import logging
import os
from datetime import datetime, timedelta

import mlflow
from mlflow.entities import SpanEvent, SpanStatus, SpanStatusCode, SpanType
from mlflow.tracing.constant import SpanAttributeKey, TokenUsageKey
from mlflow.tracing.fluent import start_span_no_context

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import MLflowConfig
from core.ops.entities.trace_entity import (
    BaseTraceInfo,
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    TraceTaskName,
    WorkflowTraceInfo,
)
from extensions.ext_database import db
from models.workflow import WorkflowNodeExecutionModel

logger = logging.getLogger(__name__)


def datetime_to_nanoseconds(dt: datetime | None) -> int | None:
    """Convert datetime to nanosecond timestamp for MLflow API"""
    if dt is None:
        return None
    return int(dt.timestamp() * 1_000_000_000)


class MLflowDataTrace(BaseTraceInstance):
    def __init__(self, mlflow_config: MLflowConfig):
        super().__init__(mlflow_config)
        self.mlflow_config = mlflow_config
        self._setup_mlflow(mlflow_config)

    def _setup_mlflow(self, config: MLflowConfig):
        mlflow.set_tracking_uri(config.tracking_uri)
        mlflow.set_experiment(experiment_id=config.experiment_id)

        # Simple auth if provided
        if config.username and config.password:
            os.environ["MLFLOW_TRACKING_USERNAME"] = config.username
            os.environ["MLFLOW_TRACKING_PASSWORD"] = config.password

    def trace(self, trace_info: BaseTraceInfo):
        """Simple dispatch to trace methods"""
        try:
            if isinstance(trace_info, WorkflowTraceInfo):
                self.workflow_trace(trace_info)
            elif isinstance(trace_info, MessageTraceInfo):
                self.message_trace(trace_info)
            elif isinstance(trace_info, ToolTraceInfo):
                self.tool_trace(trace_info)
            elif isinstance(trace_info, ModerationTraceInfo):
                self.moderation_trace(trace_info)
            elif isinstance(trace_info, DatasetRetrievalTraceInfo):
                self.dataset_retrieval_trace(trace_info)
            elif isinstance(trace_info, SuggestedQuestionTraceInfo):
                self.suggested_question_trace(trace_info)
            elif isinstance(trace_info, GenerateNameTraceInfo):
                self.generate_name_trace(trace_info)
        except Exception as e:
            logger.exception("[MLflow] Trace error")
            raise

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        """Create workflow span as root, with node spans as children"""
        workflow_span = start_span_no_context(
            name=TraceTaskName.WORKFLOW_TRACE.value,
            span_type=SpanType.CHAIN,
            inputs=trace_info.workflow_run_inputs,
            attributes={
                # TODO: Replace this with reserved attribute
                "conversation_id": trace_info.conversation_id,
                "workflow_run_id": trace_info.workflow_run_id or "",
                "message_id": trace_info.message_id or "",
                "workflow_app_log_id": trace_info.workflow_app_log_id or "",
                "total_tokens": trace_info.total_tokens or 0,
            },
            start_time_ns=datetime_to_nanoseconds(trace_info.start_time),
        )

        # TODO: set session ID and user ID to trace metadata

        try:
            # Create child spans for workflow nodes
            for node in self._get_workflow_nodes(trace_info.workflow_run_id):
                node_span = start_span_no_context(
                    name=node.node_type,
                    span_type=self._get_node_span_type(node.node_type),
                    parent_span=workflow_span,  # Use stored workflow span as parent
                    inputs=node.inputs,
                    attributes={
                        "node_id": node.id,
                        "node_type": node.node_type,
                        "node_status": node.status,
                        "tenant_id": node.tenant_id,
                        "app_id": node.app_id,
                        "app_name": node.title,
                        "status": node.status,
                    },
                    start_time_ns=datetime_to_nanoseconds(node.created_at),
                )

                # Handle node errors
                if node.status != "succeeded":
                    node_span.set_status(SpanStatus(SpanStatusCode.ERROR))
                    node_span.add_event(SpanEvent(
                        name="error",
                        attributes={
                            "exception.message": f"Node failed with status: {node.status}",
                            "exception.type": "Error",
                            "exception.stacktrace": f"Node failed with status: {node.status}",
                        }
                    ))

                # End node span with timing
                finished_at = node.created_at + timedelta(seconds=node.elapsed_time)
                node_span.end(
                    outputs=json.loads(node.outputs) if node.outputs else {},
                    end_time_ns=datetime_to_nanoseconds(finished_at),
                )

            # Handle workflow-level errors
            if trace_info.error:
                workflow_span.set_status(SpanStatus(SpanStatusCode.ERROR))
                workflow_span.add_event(SpanEvent(
                    name="error",
                    attributes={
                        "exception.message": trace_info.error,
                        "exception.type": "Error",
                        "exception.stacktrace": trace_info.error,
                    }
                ))

        finally:
            workflow_span.end(
                outputs=trace_info.workflow_run_outputs,
                end_time_ns=datetime_to_nanoseconds(trace_info.end_time),
            )

    def message_trace(self, trace_info: MessageTraceInfo):
        """Create message span with parent lookup"""
        if not trace_info.message_data:
            return

        span = start_span_no_context(
            name=TraceTaskName.MESSAGE_TRACE.value,
            span_type=SpanType.LLM,
            parent_span=parent_span,  # Use found parent or None
            inputs=trace_info.inputs,
            attributes={
                "message_id": trace_info.message_id,
                "model_provider": trace_info.message_data.model_provider,
                "model_id": trace_info.message_data.model_id,
            },
            start_time_ns=datetime_to_nanoseconds(trace_info.start_time),
        )
        # Set token usage
        span.set_attribute(
            SpanAttributeKey.CHAT_USAGE, {
                TokenUsageKey.INPUT_TOKENS: trace_info.message_tokens or 0,
                TokenUsageKey.OUTPUT_TOKENS: trace_info.answer_tokens or 0,
                TokenUsageKey.TOTAL_TOKENS: trace_info.total_tokens or 0,
            }
        )

        if trace_info.error:
            span.set_status(SpanStatus(SpanStatusCode.ERROR))
            span.add_event(SpanEvent(
                name="error",
                attributes={
                    "exception.message": trace_info.error,
                    "exception.type": "Error",
                    "exception.stacktrace": trace_info.error,
                }
            ))

        span.end(
            outputs=trace_info.message_data.answer,
            end_time_ns=datetime_to_nanoseconds(trace_info.end_time),
        )

    def tool_trace(self, trace_info: ToolTraceInfo):
        span = start_span_no_context(
            name=trace_info.tool_name,
            span_type=SpanType.TOOL,
            parent_span=parent_span, # TODO: set parent span
            inputs=trace_info.tool_inputs,
            attributes={
                "message_id": trace_info.message_id,
                "metadata": trace_info.metadata,
                "tool_config": trace_info.tool_config,
                "tool_parameters": trace_info.tool_parameters,
            },
            start_time_ns=datetime_to_nanoseconds(trace_info.start_time),
        )

        # Handle tool errors
        if trace_info.error:
            span.set_status(SpanStatus(SpanStatusCode.ERROR))
            span.add_event(SpanEvent(
                name="error",
                attributes={
                    "exception.message": trace_info.error,
                    "exception.type": "Error",
                    "exception.stacktrace": trace_info.error,
                }
            ))

        span.end(
            outputs=trace_info.tool_outputs,
            end_time_ns=datetime_to_nanoseconds(trace_info.end_time),
        )

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            return

        start_time = trace_info.start_time or trace_info.message_data.created_at
        span = start_span_no_context(
            name=TraceTaskName.MODERATION_TRACE.value,
            span_type=SpanType.TOOL,
            parent_span=parent_span,
            inputs=trace_info.inputs or {},
            attributes={
                "message_id": trace_info.message_id,
                "metadata": trace_info.metadata,
            },
            start_time_ns=datetime_to_nanoseconds(start_time),
        )

        span.end(
            outputs={
                "action": trace_info.action,
                "flagged": trace_info.flagged,
                "preset_response": trace_info.preset_response,
            },
            end_time_ns=datetime_to_nanoseconds(trace_info.end_time),
        )

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return

        span = start_span_no_context(
            name=TraceTaskName.DATASET_RETRIEVAL_TRACE.value,
            span_type=SpanType.RETRIEVER,
            parent_span=parent_span,
            inputs=trace_info.inputs,
            attributes={
                "message_id": trace_info.message_id,
                "metadata": trace_info.metadata,
            },
            start_time_ns=datetime_to_nanoseconds(trace_info.start_time),
        )
        span.end(
            outputs={"documents": trace_info.documents},
            end_time_ns=datetime_to_nanoseconds(trace_info.end_time)
        )

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        if trace_info.message_data is None:
            return

        start_time = trace_info.start_time or trace_info.message_data.created_at
        end_time = trace_info.end_time or trace_info.message_data.updated_at

        span = start_span_no_context(
            name=TraceTaskName.SUGGESTED_QUESTION_TRACE.value,
            span_type=SpanType.TOOL,
            parent_span=parent_span,
            inputs=trace_info.inputs,
            attributes={
                "message_id": trace_info.message_id,
                "model_provider": trace_info.model_provider,
                "model_id": trace_info.model_id,
                "total_tokens": trace_info.total_tokens or 0,
            },
            start_time_ns=datetime_to_nanoseconds(start_time),
        )

        if trace_info.error:
            span.set_status(SpanStatus(SpanStatusCode.ERROR))
            span.add_event(SpanEvent(
                name="error",
                attributes={
                    "exception.message": trace_info.error,
                    "exception.type": "Error",
                    "exception.stacktrace": trace_info.error,
                }
            ))

        span.end(
            outputs=trace_info.suggested_question,
            end_time_ns=datetime_to_nanoseconds(end_time)
        )

    def generate_name_trace(self, trace_info: GenerateNameTraceInfo):
        span = start_span_no_context(
            name=TraceTaskName.GENERATE_NAME_TRACE.value,
            span_type=SpanType.CHAIN,
            parent_span=parent_span,
            inputs=trace_info.inputs,
            attributes={"message_id": trace_info.message_id},
            start_time_ns=datetime_to_nanoseconds(trace_info.start_time),
        )
        span.end(outputs=trace_info.outputs, end_time_ns=datetime_to_nanoseconds(trace_info.end_time))


    def _get_workflow_nodes(self, workflow_run_id: str):
        """Helper method to get workflow nodes"""
        workflow_nodes = (
            db.session.query(
                WorkflowNodeExecutionModel.id,
                WorkflowNodeExecutionModel.tenant_id,
                WorkflowNodeExecutionModel.app_id,
                WorkflowNodeExecutionModel.title,
                WorkflowNodeExecutionModel.node_type,
                WorkflowNodeExecutionModel.status,
                WorkflowNodeExecutionModel.inputs,
                WorkflowNodeExecutionModel.outputs,
                WorkflowNodeExecutionModel.created_at,
                WorkflowNodeExecutionModel.elapsed_time,
                WorkflowNodeExecutionModel.process_data,
                WorkflowNodeExecutionModel.execution_metadata,
            )
            .filter(WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id)
            .all()
        )
        return workflow_nodes

    def _get_node_span_type(self, node_type: str) -> str:
        """Map Dify node types to MLflow span types"""
        node_type_mapping = {
            "llm": "LLM",
            "dataset_retrieval": "RETRIEVER",
            "tool": "TOOL",
            "code": "CHAIN",
            "if_else": "CHAIN",
            "variable_assigner": "CHAIN",
            "start": "CHAIN",
            "end": "CHAIN",
        }
        return node_type_mapping.get(node_type, "CHAIN")

    def api_check(self):
        """Simple connection test"""
        try:
            mlflow.search_experiments(max_results=1)
            return True
        except Exception as e:
            raise ValueError(f"MLflow connection failed: {str(e)}")

    def get_project_url(self):
        """Return MLflow UI URL"""
        return f"{self.mlflow_config.tracking_uri}/#/"