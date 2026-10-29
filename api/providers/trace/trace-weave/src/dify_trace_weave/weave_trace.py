import logging
import os
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta
from typing import Any, cast, override

from sqlalchemy.orm import sessionmaker
from weave.trace_server.trace_server_interface import (
    CallEndReq,
    CallStartReq,
    EndedCallSchemaForInsert,
    StartedCallSchemaForInsert,
    SummaryInsertMap,
    TraceStatus,
)

from core.ops.base_trace_instance import BaseTraceInstance
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
from core.ops.exceptions import RetryableTraceDispatchError
from core.repositories import DifyCoreRepositoryFactory
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.configuration import console_url, project_url, verify_configuration
from dify_trace_weave.entities.weave_trace_entity import WeaveTraceModel
from dify_trace_weave.transport import TraceServer, resolve_project
from extensions.ext_database import db
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from models import EndUser, MessageFile, WorkflowNodeExecutionTriggeredFrom
from services.tracing.provider_common import endpoint
from services.tracing.provider_dispatch import TraceExportUncertainError

logger = logging.getLogger(__name__)
_dispatch_started_calls: ContextVar[dict[str, dict[str, Any]] | None] = ContextVar("weave_dispatch_calls", default=None)


def _same_identifier(actual: str, expected: str) -> bool:
    """Accept UUID formatting differences without rewriting legacy wire identifiers."""
    if actual == expected:
        return True
    try:
        return uuid.UUID(actual) == uuid.UUID(expected)
    except ValueError:
        return False


class WeaveDataTrace(BaseTraceInstance):
    def __init__(
        self,
        weave_config: WeaveConfig,
    ):
        super().__init__(weave_config)
        # Construction is local: no global SDK client, login, netrc, or background queue.
        self._config = weave_config.model_copy(deep=True)
        self.weave_api_key = self._config.api_key
        self.project_name = self._config.project
        self.entity = self._config.entity
        self.host = self._config.host
        self.server = TraceServer(  # pyrefly: ignore[bad-instantiation]
            endpoint(self._config.endpoint), should_batch=False, auth=("api", self.weave_api_key)
        )
        self._project_id: str | None = None
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")
        self.calls: dict[str, Any] = {}

    @property
    def project_id(self) -> str:
        # Existing saved configurations may omit entity. Resolve it lazily with
        # this instance's credentials, never W&B's process-global defaults.
        if self._project_id is None:
            entity, project, _ = resolve_project(self._config.model_dump(), self.weave_api_key)
            self._project_id = f"{entity}/{project}"
        return self._project_id

    def get_project_url(self):
        return project_url(self._config) or console_url(self._config)

    @override
    def trace(self, trace_info: BaseTraceInfo):
        logger.debug("Trace info: %s", trace_info)
        accepted_calls: dict[str, dict[str, Any]] = {}
        token = _dispatch_started_calls.set(accepted_calls)
        try:
            match trace_info:
                case WorkflowTraceInfo():
                    self.workflow_trace(trace_info)
                case MessageTraceInfo():
                    self.message_trace(trace_info)
                case ModerationTraceInfo():
                    self.moderation_trace(trace_info)
                case SuggestedQuestionTraceInfo():
                    self.suggested_question_trace(trace_info)
                case DatasetRetrievalTraceInfo():
                    self.dataset_retrieval_trace(trace_info)
                case ToolTraceInfo():
                    self.tool_trace(trace_info)
                case GenerateNameTraceInfo():
                    self.generate_name_trace(trace_info)
                case _:
                    pass
        except RetryableTraceDispatchError as error:
            if accepted_calls and not error.acceptance_unknown:
                raise TraceExportUncertainError(
                    "Weave trace was partially accepted; automatic retry is unsafe"
                ) from None
            raise
        finally:
            for call_id, call_meta in accepted_calls.items():
                if self.calls.get(call_id) is call_meta:
                    self.calls.pop(call_id, None)
            _dispatch_started_calls.reset(token)

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        trace_id = trace_info.trace_id or trace_info.message_id or trace_info.workflow_run_id
        if trace_info.start_time is None:
            trace_info.start_time = datetime.now()

        if trace_info.message_id:
            message_attributes = trace_info.metadata
            message_attributes["workflow_app_log_id"] = trace_info.workflow_app_log_id

            message_attributes["message_id"] = trace_info.message_id
            message_attributes["workflow_run_id"] = trace_info.workflow_run_id
            message_attributes["trace_id"] = trace_id
            message_attributes["start_time"] = trace_info.start_time
            message_attributes["end_time"] = trace_info.end_time
            message_attributes["tags"] = ["message", "workflow"]

            message_run = WeaveTraceModel(
                id=trace_info.message_id,
                op=str(TraceTaskName.MESSAGE_TRACE),
                inputs=dict(trace_info.workflow_run_inputs),
                outputs=dict(trace_info.workflow_run_outputs),
                total_tokens=trace_info.total_tokens,
                attributes=message_attributes,
                exception=trace_info.error,
                file_list=[],
            )
            self.start_call(message_run, parent_run_id=trace_info.workflow_run_id)
            self.finish_call(message_run)

        workflow_attributes = trace_info.metadata
        workflow_attributes["workflow_run_id"] = trace_info.workflow_run_id
        workflow_attributes["trace_id"] = trace_id
        workflow_attributes["start_time"] = trace_info.start_time
        workflow_attributes["end_time"] = trace_info.end_time
        workflow_attributes["tags"] = ["dify_workflow"]

        workflow_run = WeaveTraceModel(
            file_list=trace_info.file_list,
            total_tokens=trace_info.total_tokens,
            id=trace_info.workflow_run_id,
            op=str(TraceTaskName.WORKFLOW_TRACE),
            inputs=dict(trace_info.workflow_run_inputs),
            outputs=dict(trace_info.workflow_run_outputs),
            attributes=workflow_attributes,
            exception=trace_info.error,
        )

        self.start_call(workflow_run, parent_run_id=trace_info.message_id)

        # through workflow_run_id get all_nodes_execution using repository
        session_factory = sessionmaker(bind=db.engine)
        # Find the app's creator account
        app_id = trace_info.metadata.get("app_id")
        if not app_id:
            raise ValueError("No app_id found in trace_info metadata")

        service_account = self.get_service_account_with_tenant(app_id)

        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            tenant_id=trace_info.tenant_id,
            user=service_account,
            app_id=app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        # Get all executions for this workflow run
        workflow_node_executions = workflow_node_execution_repository.get_by_workflow_execution(
            workflow_execution_id=trace_info.workflow_run_id
        )

        # rearrange workflow_node_executions by starting time
        workflow_node_executions = sorted(workflow_node_executions, key=lambda x: x.created_at)

        for node_execution in workflow_node_executions:
            node_execution_id = node_execution.id
            tenant_id = trace_info.tenant_id  # Use from trace_info instead
            app_id = trace_info.metadata.get("app_id")  # Use from trace_info instead
            node_name = node_execution.title
            node_type = node_execution.node_type
            status = node_execution.status
            if node_type == BuiltinNodeTypes.LLM:
                inputs = node_execution.process_data.get("prompts", {}) if node_execution.process_data else {}
            else:
                inputs = node_execution.inputs or {}
            outputs = node_execution.outputs or {}
            created_at = node_execution.created_at or datetime.now()
            elapsed_time = node_execution.elapsed_time
            finished_at = created_at + timedelta(seconds=elapsed_time)

            execution_metadata = node_execution.metadata or {}
            node_total_tokens = execution_metadata.get(WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS) or 0
            attributes = {str(k): v for k, v in execution_metadata.items()}
            attributes.update(
                {
                    "workflow_run_id": trace_info.workflow_run_id,
                    "node_execution_id": node_execution_id,
                    "tenant_id": tenant_id,
                    "app_id": app_id,
                    "app_name": node_name,
                    "node_type": node_type,
                    "status": status,
                }
            )

            process_data = node_execution.process_data or {}
            if process_data and process_data.get("model_mode") == "chat":
                attributes.update(
                    {
                        "ls_provider": process_data.get("model_provider", ""),
                        "ls_model_name": process_data.get("model_name", ""),
                    }
                )
            attributes["tags"] = ["node_execution"]
            attributes["start_time"] = created_at
            attributes["end_time"] = finished_at
            attributes["elapsed_time"] = elapsed_time
            attributes["workflow_run_id"] = trace_info.workflow_run_id
            attributes["trace_id"] = trace_id
            node_run = WeaveTraceModel(
                total_tokens=node_total_tokens,
                op=node_type,
                inputs=inputs,
                outputs=outputs,
                file_list=trace_info.file_list,
                attributes=attributes,
                id=node_execution_id,
                exception=None,
            )

            self.start_call(node_run, parent_run_id=trace_info.workflow_run_id)
            self.finish_call(node_run)

        self.finish_call(workflow_run)

    def message_trace(self, trace_info: MessageTraceInfo):
        # get message file data
        file_list = cast(list[str], trace_info.file_list) or []
        message_file_data: MessageFile | None = trace_info.message_file_data
        file_url = f"{self.file_base_url}/{message_file_data.url}" if message_file_data else ""
        file_list.append(file_url)
        attributes = trace_info.metadata
        message_data = trace_info.message_data
        if message_data is None:
            return
        message_id = message_data.id

        user_id = message_data.from_account_id
        attributes["user_id"] = user_id

        if message_data.from_end_user_id:
            end_user_data: EndUser | None = db.session.get(EndUser, message_data.from_end_user_id)
            if end_user_data is not None:
                end_user_id = end_user_data.session_id
                attributes["end_user_id"] = end_user_id

        attributes["message_id"] = message_id
        attributes["start_time"] = trace_info.start_time
        attributes["end_time"] = trace_info.end_time
        attributes["tags"] = ["message", str(trace_info.conversation_mode)]

        trace_id = trace_info.trace_id or message_id
        attributes["trace_id"] = trace_id

        message_run = WeaveTraceModel(
            id=trace_id,
            op=str(TraceTaskName.MESSAGE_TRACE),
            input_tokens=trace_info.message_tokens,
            output_tokens=trace_info.answer_tokens,
            total_tokens=trace_info.total_tokens,
            inputs=trace_info.inputs,
            outputs=trace_info.outputs,
            exception=trace_info.error,
            file_list=file_list,
            attributes=attributes,
        )
        self.start_call(message_run)

        # create llm run parented to message run
        llm_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            input_tokens=trace_info.message_tokens,
            output_tokens=trace_info.answer_tokens,
            total_tokens=trace_info.total_tokens,
            op="llm",
            inputs=trace_info.inputs,
            outputs=trace_info.outputs,
            attributes=attributes,
            file_list=[],
            exception=None,
        )
        self.start_call(
            llm_run,
            parent_run_id=trace_id,
        )
        self.finish_call(llm_run)
        self.finish_call(message_run)

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            return

        attributes = trace_info.metadata
        attributes["tags"] = ["moderation"]
        attributes["message_id"] = trace_info.message_id
        attributes["start_time"] = trace_info.start_time or trace_info.message_data.created_at
        attributes["end_time"] = trace_info.end_time or trace_info.message_data.updated_at

        trace_id = trace_info.trace_id or trace_info.message_id
        attributes["trace_id"] = trace_id

        moderation_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            op=str(TraceTaskName.MODERATION_TRACE),
            inputs=trace_info.inputs,
            outputs={
                "action": trace_info.action,
                "flagged": trace_info.flagged,
                "preset_response": trace_info.preset_response,
                "inputs": trace_info.inputs,
            },
            attributes=attributes,
            exception=getattr(trace_info, "error", None),
            file_list=[],
        )
        self.start_call(moderation_run, parent_run_id=trace_id)
        self.finish_call(moderation_run)

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        message_data = trace_info.message_data
        if message_data is None:
            return
        attributes = trace_info.metadata
        attributes["message_id"] = trace_info.message_id
        attributes["tags"] = ["suggested_question"]
        attributes["start_time"] = (trace_info.start_time or message_data.created_at,)
        attributes["end_time"] = (trace_info.end_time or message_data.updated_at,)

        trace_id = trace_info.trace_id or trace_info.message_id
        attributes["trace_id"] = trace_id

        suggested_question_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            op=str(TraceTaskName.SUGGESTED_QUESTION_TRACE),
            inputs=trace_info.inputs,
            outputs=trace_info.suggested_question,
            attributes=attributes,
            exception=trace_info.error,
            file_list=[],
        )

        self.start_call(suggested_question_run, parent_run_id=trace_id)
        self.finish_call(suggested_question_run)

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return
        attributes = trace_info.metadata
        attributes["message_id"] = trace_info.message_id
        attributes["tags"] = ["dataset_retrieval"]
        attributes["start_time"] = (trace_info.start_time or trace_info.message_data.created_at,)
        attributes["end_time"] = (trace_info.end_time or trace_info.message_data.updated_at,)

        trace_id = trace_info.trace_id or trace_info.message_id
        attributes["trace_id"] = trace_id

        dataset_retrieval_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            op=str(TraceTaskName.DATASET_RETRIEVAL_TRACE),
            inputs=trace_info.inputs,
            outputs={"documents": trace_info.documents},
            attributes=attributes,
            exception=getattr(trace_info, "error", None),
            file_list=[],
        )

        self.start_call(dataset_retrieval_run, parent_run_id=trace_id)
        self.finish_call(dataset_retrieval_run)

    def tool_trace(self, trace_info: ToolTraceInfo):
        attributes = trace_info.metadata
        attributes["tags"] = ["tool", trace_info.tool_name]
        attributes["start_time"] = trace_info.start_time
        attributes["end_time"] = trace_info.end_time

        message_id = trace_info.message_id or getattr(trace_info, "conversation_id", None)
        message_id = message_id or None
        trace_id = trace_info.trace_id or message_id
        attributes["trace_id"] = trace_id

        tool_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            op=trace_info.tool_name,
            inputs=trace_info.tool_inputs,
            outputs=trace_info.tool_outputs,
            file_list=[cast(str, trace_info.file_url)] if trace_info.file_url else [],
            attributes=attributes,
            exception=trace_info.error,
        )
        self.start_call(tool_run, parent_run_id=trace_id)
        self.finish_call(tool_run)

    def generate_name_trace(self, trace_info: GenerateNameTraceInfo):
        attributes = trace_info.metadata
        attributes["tags"] = ["generate_name"]
        attributes["start_time"] = trace_info.start_time
        attributes["end_time"] = trace_info.end_time

        name_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            op=str(TraceTaskName.GENERATE_NAME_TRACE),
            inputs=trace_info.inputs,
            outputs=trace_info.outputs,
            attributes=attributes,
            exception=getattr(trace_info, "error", None),
            file_list=[],
        )

        self.start_call(name_run)
        self.finish_call(name_run)

    def api_check(self):
        # Read-only credential/project/endpoint verification; it creates no calls.
        verify_configuration(self._config)
        return True

    def _normalize_time(self, dt: datetime | None) -> datetime:
        if dt is None:
            return datetime.now(UTC)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt

    def start_call(self, run_data: WeaveTraceModel, parent_run_id: str | None = None):
        inputs = run_data.inputs
        if inputs is None:
            inputs = {}
        elif not isinstance(inputs, dict):
            inputs = {"inputs": str(inputs)}

        attributes = run_data.attributes
        if attributes is None:
            attributes = {}
        elif not isinstance(attributes, dict):
            attributes = {"attributes": str(attributes)}

        start_time = attributes.get("start_time") if isinstance(attributes, dict) else None
        started_at = self._normalize_time(start_time if isinstance(start_time, datetime) else None)
        trace_id = attributes.get("trace_id") if isinstance(attributes, dict) else None
        if trace_id is None:
            trace_id = run_data.id

        call_start_req = CallStartReq(
            start=StartedCallSchemaForInsert(
                project_id=self.project_id,
                id=run_data.id,
                op_name=str(run_data.op),
                trace_id=trace_id,
                parent_id=parent_run_id,
                started_at=started_at,
                attributes=attributes,
                inputs=inputs,
                wb_user_id=None,
            )
        )
        started = self.server.call_start(call_start_req)
        if not _same_identifier(started.id, run_data.id) or not _same_identifier(started.trace_id, trace_id):
            raise TraceExportUncertainError("Weave did not acknowledge the submitted identifiers")
        call_meta = {"trace_id": trace_id, "parent_id": parent_run_id}
        self.calls[run_data.id] = call_meta
        dispatch_calls = _dispatch_started_calls.get()
        if dispatch_calls is not None:
            dispatch_calls[run_data.id] = call_meta

    def finish_call(self, run_data: WeaveTraceModel):
        call_meta = self.calls.get(run_data.id)
        if not call_meta:
            raise ValueError(f"Call with id {run_data.id} not found")

        attributes = run_data.attributes
        if attributes is None:
            attributes = {}
        elif not isinstance(attributes, dict):
            attributes = {"attributes": str(attributes)}

        start_time = attributes.get("start_time") if isinstance(attributes, dict) else None
        end_time = attributes.get("end_time") if isinstance(attributes, dict) else None
        started_at = self._normalize_time(start_time if isinstance(start_time, datetime) else None)
        ended_at = self._normalize_time(end_time if isinstance(end_time, datetime) else None)
        elapsed_ms = int((ended_at - started_at).total_seconds() * 1000)
        if elapsed_ms < 0:
            elapsed_ms = 0

        status_counts = {
            TraceStatus.SUCCESS: 0,
            TraceStatus.ERROR: 0,
        }
        if run_data.exception:
            status_counts[TraceStatus.ERROR] = 1
        else:
            status_counts[TraceStatus.SUCCESS] = 1

        summary: dict[str, Any] = {
            "status_counts": status_counts,
            "weave": {"latency_ms": elapsed_ms},
        }

        exception_str = str(run_data.exception) if run_data.exception else None

        call_end_req = CallEndReq(
            end=EndedCallSchemaForInsert(
                project_id=self.project_id,
                id=run_data.id,
                ended_at=ended_at,
                exception=exception_str,
                output=run_data.outputs,
                summary=cast(SummaryInsertMap, summary),
            )
        )
        try:
            self.server.call_end(call_end_req)
        finally:
            self.calls.pop(run_data.id, None)
