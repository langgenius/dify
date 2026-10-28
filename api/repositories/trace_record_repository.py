"""Assemble trace records from events and trusted database state.

Every record is read through the event's tenant and app: a reference that does
not belong to them is missing, never trusted. Events carry only identifiers
and facts persisted nowhere else, so records reflect committed state. Rows
become plain records before their session closes.
"""

import json
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from typing import Any, override

from dify_trace_sdk.events import (
    ConversationNamed,
    DatasetRetrieved,
    DraftNodeExecuted,
    MessageCompleted,
    ModerationChecked,
    PromptGenerated,
    SuggestedQuestionsGenerated,
    ToolInvoked,
    TraceEvent,
    WorkflowRunCompleted,
)
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.repositories import DifyCoreRepositoryFactory
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowExecutionStatus
from models import Account, App, Tenant
from models.dataset import Dataset
from models.model import AppMode, Conversation, EndUser, Message, MessageFile
from models.provider import Provider, ProviderCredential, ProviderModel, ProviderModelCredential, ProviderType
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider, WorkflowToolProvider
from models.workflow import WorkflowAppLog, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from repositories.tracing_store_errors import tracing_store_errors
from services.tracing.delivery import OuterRunQuery, OuterRunRoot, TraceRecordSource
from services.tracing.errors import SourceNotFoundError, SourceNotReadyError
from services.tracing.records import (
    BaseTraceInfo,
    DatasetRetrievalTraceInfo,
    DraftNodeExecutionTrace,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    PromptGenerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    TraceMessage,
    WorkflowTraceInfo,
)

_TERMINAL_WORKFLOW_STATUSES = frozenset(
    {
        WorkflowExecutionStatus.SUCCEEDED,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
        WorkflowExecutionStatus.FAILED,
        WorkflowExecutionStatus.STOPPED,
    }
)
_TOOL_PROVIDER_MODELS: dict[
    str, type[BuiltinToolProvider | ApiToolProvider | WorkflowToolProvider | MCPToolProvider]
] = {
    "builtin": BuiltinToolProvider,
    "plugin": BuiltinToolProvider,
    "api": ApiToolProvider,
    "workflow": WorkflowToolProvider,
    "mcp": MCPToolProvider,
}


def _user_of(metadata: Mapping[str, Any]) -> str:
    """Who invoked the operation: end user before account, as the enterprise data dictionary defines."""
    if user_id := metadata.get("from_end_user_id"):
        return f"end_user:{user_id}"
    if user_id := metadata.get("from_account_id"):
        return f"account:{user_id}"
    if user_id := metadata.get("user_id"):
        return f"user:{user_id}"
    return "anonymous"


def _text_input(inputs: Mapping[str, Any], *names: str) -> str:
    """The first text value among ``names``; apps may define inputs of these names with any type."""
    return next((value for name in names if isinstance(value := inputs.get(name), str) and value), "")


def _trace_message(message: Message) -> TraceMessage:
    return TraceMessage(
        id=message.id,
        app_id=message.app_id,
        conversation_id=message.conversation_id,
        workflow_run_id=message.workflow_run_id,
        query=message.query,
        answer=message.answer,
        error=message.error,
        created_at=message.created_at,
        model_provider=message.model_provider,
        model_id=message.model_id,
        total_price=message.total_price,
        currency=message.currency,
    )


def _streaming_metrics(message: Message) -> dict[str, Any]:
    if not message.message_metadata:
        return {}
    try:
        metadata = json.loads(message.message_metadata)
    except ValueError:
        return {}
    usage = metadata.get("usage") if isinstance(metadata, dict) else None
    if not isinstance(usage, dict):
        return {}
    time_to_first_token = usage.get("time_to_first_token")
    return {
        "gen_ai_server_time_to_first_token": time_to_first_token,
        "llm_streaming_time_to_generate": usage.get("time_to_generate"),
        "is_streaming_request": time_to_first_token is not None,
    }


class TraceRecordRepository(TraceRecordSource, OuterRunQuery):
    def __init__(self, session_factory: sessionmaker[Session], *, files_url: str, enterprise_details: bool) -> None:
        self._sessions = session_factory
        self._files_url = files_url
        # App, workspace, and credential names are enterprise telemetry dimensions only.
        self._enterprise_details = enterprise_details

    @override
    def assemble(self, event: TraceEvent) -> BaseTraceInfo:
        match event.payload:
            case MessageCompleted() as payload:
                return self._message(event, payload)
            case WorkflowRunCompleted() as payload:
                return self._workflow(event, payload)
            case ModerationChecked() as payload:
                return self._moderation(event, payload)
            case SuggestedQuestionsGenerated() as payload:
                return self._suggested_questions(event, payload)
            case DatasetRetrieved() as payload:
                return self._dataset_retrieval(event, payload)
            case ToolInvoked() as payload:
                return self._tool(event, payload)
            case ConversationNamed() as payload:
                return self._conversation_name(event, payload)
            case PromptGenerated() as payload:
                return self._prompt_generation(event, payload)
            case DraftNodeExecuted() as payload:
                return self._draft_node(event, payload)

    # Shared lookups

    @override
    def root(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> OuterRunRoot | None:
        runs = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._sessions)
        with tracing_store_errors():
            run = runs.get_workflow_run_by_id(tenant_id=tenant_id, app_id=app_id, run_id=workflow_run_id)
        if run is None:
            return None
        with tracing_store_errors(), self._sessions() as session:
            mode = session.scalar(select(App.mode).where(App.id == app_id, App.tenant_id == tenant_id))
            if mode is not AppMode.ADVANCED_CHAT:
                return OuterRunRoot(root_id=run.id, started_at=run.created_at)
            message = session.execute(
                select(Message.id, Message.created_at).where(
                    Message.app_id == app_id, Message.workflow_run_id == run.id
                )
            ).first()
        if message is None:
            return None
        message_id, created_at = message
        return OuterRunRoot(root_id=message_id, started_at=created_at)

    @override
    def node_started_at(
        self, *, tenant_id: str, app_id: str, workflow_run_id: str, node_execution_id: str
    ) -> datetime | None:
        executions = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(self._sessions)
        with tracing_store_errors():
            execution = executions.get_execution_by_id(execution_id=node_execution_id, tenant_id=tenant_id)
        if execution is None or execution.app_id != app_id or execution.workflow_run_id != workflow_run_id:
            return None
        return execution.created_at

    def _app(self, session: Session, event: TraceEvent) -> App:
        app = session.scalar(select(App).where(App.id == event.app_id, App.tenant_id == event.tenant_id))
        if app is None:
            raise SourceNotFoundError
        return app

    def _message_in_app(self, session: Session, event: TraceEvent, message_id: str | None) -> Message:
        if message_id is None:
            raise SourceNotFoundError
        message = session.scalar(
            select(Message)
            .join(App, App.id == Message.app_id)
            .where(Message.id == message_id, Message.app_id == event.app_id, App.tenant_id == event.tenant_id)
        )
        if message is None:
            # Producers inside a request transaction may report before their message commits.
            raise SourceNotReadyError
        return message

    @staticmethod
    def _end_user_session_id(session: Session, message: Message, tenant_id: str) -> str | None:
        if not message.from_end_user_id:
            return None
        return session.scalar(
            select(EndUser.session_id).where(EndUser.id == message.from_end_user_id, EndUser.tenant_id == tenant_id)
        )

    def _names(self, session: Session, app_id: str | None, tenant_id: str) -> tuple[str, str]:
        if not self._enterprise_details:
            return "", ""
        app_name = (
            session.scalar(select(App.name).where(App.id == app_id, App.tenant_id == tenant_id)) if app_id else None
        )
        workspace_name = session.scalar(select(Tenant.name).where(Tenant.id == tenant_id))
        return app_name or "", workspace_name or ""

    @staticmethod
    def _workflow_app_log_id(session: Session, message: Message) -> str | None:
        if not message.workflow_run_id:
            return None
        log_id = session.scalar(
            select(WorkflowAppLog.id)
            .where(WorkflowAppLog.app_id == message.app_id, WorkflowAppLog.workflow_run_id == message.workflow_run_id)
            .limit(1)
        )
        return str(log_id) if log_id else None

    @staticmethod
    def _message_metadata(message: Message) -> dict[str, Any]:
        return {
            "message_id": message.id,
            "ls_provider": message.model_provider,
            "ls_model_name": message.model_id,
            "status": message.status,
            "from_end_user_id": message.from_end_user_id,
            "from_account_id": message.from_account_id,
            "agent_based": message.agent_based,
            "workflow_run_id": message.workflow_run_id,
            "from_source": message.from_source,
        }

    @staticmethod
    def _correlation_metadata(event: TraceEvent) -> dict[str, Any]:
        metadata: dict[str, Any] = {"trace_event_id": event.event_id}
        if event.correlation.session_id:
            metadata["trace_session_id"] = event.correlation.session_id
        return metadata

    # Records

    def _message(self, event: TraceEvent, payload: MessageCompleted) -> MessageTraceInfo:
        with tracing_store_errors(), self._sessions() as session:
            message = self._message_in_app(session, event, payload.message_id)
            conversation_mode = session.scalar(
                select(Conversation.mode).where(
                    Conversation.id == message.conversation_id, Conversation.app_id == message.app_id
                )
            )
            if conversation_mode is None:
                raise SourceNotFoundError
            message_file = session.scalar(select(MessageFile).where(MessageFile.message_id == message.id).limit(1))
            end_user_session_id = self._end_user_session_id(session, message, event.tenant_id)
            app_name, workspace_name = self._names(session, message.app_id, event.tenant_id)

        file_list = [f"{self._files_url}/{message_file.url}"] if message_file and message_file.url else []
        metadata = {
            **self._correlation_metadata(event),
            **self._message_metadata(message),
            "conversation_id": message.conversation_id,
            "tenant_id": event.tenant_id,
            "app_id": message.app_id,
            "user_id": message.from_end_user_id or message.from_account_id,
            "end_user_session_id": end_user_session_id,
            "app_name": app_name,
            "workspace_name": workspace_name,
        }
        created_at = message.created_at
        streaming = _streaming_metrics(message)
        return MessageTraceInfo(
            trace_id=event.correlation.external_trace_id,
            message_id=message.id,
            message_data=_trace_message(message),
            conversation_model=conversation_mode,
            message_tokens=message.message_tokens,
            answer_tokens=message.answer_tokens,
            total_tokens=message.message_tokens + message.answer_tokens,
            error=message.error or "",
            inputs=message.message,
            outputs=message.answer,
            file_list=file_list,
            start_time=created_at,
            end_time=message.updated_at
            if message.updated_at and message.updated_at > created_at
            else created_at + timedelta(seconds=message.provider_response_latency),
            metadata=metadata,
            conversation_mode=conversation_mode,
            gen_ai_server_time_to_first_token=streaming.get("gen_ai_server_time_to_first_token"),
            llm_streaming_time_to_generate=streaming.get("llm_streaming_time_to_generate"),
            is_streaming_request=streaming.get("is_streaming_request", False),
        )

    def _workflow(self, event: TraceEvent, payload: WorkflowRunCompleted) -> WorkflowTraceInfo:
        if event.app_id is None:
            raise SourceNotFoundError
        runs = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._sessions)
        with tracing_store_errors():
            run = runs.get_workflow_run_by_id(
                tenant_id=event.tenant_id, app_id=event.app_id, run_id=payload.workflow_run_id
            )
        # Workflow runs may be persisted asynchronously (including LogStore indexing).
        if run is None or run.status not in _TERMINAL_WORKFLOW_STATUSES or run.finished_at is None:
            raise SourceNotReadyError
        with tracing_store_errors(), self._sessions() as session:
            self._app(session, event)
            workflow_app_log_id = session.scalar(
                select(WorkflowAppLog.id).where(
                    WorkflowAppLog.tenant_id == event.tenant_id,
                    WorkflowAppLog.app_id == event.app_id,
                    WorkflowAppLog.workflow_run_id == run.id,
                )
            )
            message_row = (
                session.execute(
                    select(Message.id, Message.created_at).where(
                        Message.app_id == event.app_id,
                        Message.conversation_id == payload.conversation_id,
                        Message.workflow_run_id == run.id,
                    )
                ).first()
                if payload.conversation_id
                else None
            )
            app_name, workspace_name = self._names(session, event.app_id, event.tenant_id)
        executions = self._node_executions(run)
        prompt_tokens, completion_tokens = self._token_split(executions)
        inputs = run.inputs_dict
        file_list = inputs.get("sys.file") or []
        total_tokens = payload.total_tokens if payload.total_tokens is not None else run.total_tokens
        metadata: dict[str, Any] = {
            **self._correlation_metadata(event),
            "workflow_id": run.workflow_id,
            "conversation_id": payload.conversation_id,
            "workflow_run_id": run.id,
            "tenant_id": event.tenant_id,
            "elapsed_time": run.elapsed_time,
            "status": run.status,
            "version": run.version,
            "total_tokens": total_tokens,
            "file_list": file_list,
            "triggered_from": run.triggered_from,
            "user_id": event.user_id,
            "app_id": run.app_id,
            "app_name": app_name,
            "workspace_name": workspace_name,
        }
        correlation = event.correlation
        if correlation.parent is not None:
            metadata["parent_trace_context"] = {
                "parent_workflow_run_id": correlation.parent.workflow_run_id,
                "parent_node_execution_id": correlation.parent.node_execution_id,
            }
        return WorkflowTraceInfo(
            trace_id=correlation.external_trace_id,
            node_executions=executions,
            conversation_id=payload.conversation_id,
            message_started_at=message_row[1] if message_row else None,
            workflow_id=run.workflow_id,
            tenant_id=event.tenant_id,
            workflow_run_id=run.id,
            workflow_run_elapsed_time=run.elapsed_time,
            workflow_run_status=run.status,
            workflow_run_inputs=inputs,
            workflow_run_outputs=run.outputs_dict,
            workflow_run_version=run.version,
            error=run.error or "",
            total_tokens=total_tokens,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            file_list=file_list,
            query=_text_input(inputs, "query", "sys.query"),
            metadata=metadata,
            workflow_app_log_id=workflow_app_log_id,
            message_id=message_row[0] if message_row else None,
            start_time=run.created_at,
            end_time=run.finished_at,
            invoked_by=_user_of(metadata),
            parent=correlation.parent,
        )

    def _node_executions(self, run: WorkflowRun) -> Sequence[WorkflowNodeExecution]:
        # Repositories take an identity only to attribute writes. This read needs no member of the
        # workspace, so a run of an app whose creator left it is still traced.
        reader = Account(name="Trace assembly", email="trace-assembly@localhost")
        reader.id = run.created_by
        repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=self._sessions,
            tenant_id=run.tenant_id,
            user=reader,
            app_id=run.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        with tracing_store_errors():
            return repository.get_by_workflow_execution(workflow_execution_id=run.id)

    @staticmethod
    def _token_split(executions: Sequence[WorkflowNodeExecution]) -> tuple[int, int]:
        """Prompt and completion totals; the run row only stores the overall total."""
        prompt_total = completion_total = 0
        for execution in executions:
            usage = (execution.outputs or {}).get("usage")
            if not isinstance(usage, Mapping):
                continue
            prompt, completion = usage.get("prompt_tokens"), usage.get("completion_tokens")
            if isinstance(prompt, int | float):
                prompt_total += int(prompt)
            if isinstance(completion, int | float):
                completion_total += int(completion)
        return prompt_total, completion_total

    def _moderation(self, event: TraceEvent, payload: ModerationChecked) -> ModerationTraceInfo:
        with tracing_store_errors(), self._sessions() as session:
            message = self._message_in_app(session, event, payload.message_id)
            workflow_app_log_id = self._workflow_app_log_id(session, message)
            end_user_session_id = self._end_user_session_id(session, message, event.tenant_id)
        metadata = {
            **self._correlation_metadata(event),
            "message_id": message.id,
            "action": payload.action,
            "preset_response": payload.preset_response,
            "query": payload.query,
            "user_id": message.from_end_user_id or message.from_account_id,
            "end_user_session_id": end_user_session_id,
        }
        return ModerationTraceInfo(
            trace_id=event.correlation.external_trace_id,
            # Enterprise telemetry keys chatflow moderation by its workflow log.
            message_id=workflow_app_log_id or message.id,
            inputs=payload.inputs,
            message_data=_trace_message(message),
            flagged=payload.flagged,
            action=payload.action,
            preset_response=payload.preset_response,
            query=payload.query,
            start_time=payload.started_at,
            end_time=payload.ended_at,
            metadata=metadata,
        )

    def _suggested_questions(
        self, event: TraceEvent, payload: SuggestedQuestionsGenerated
    ) -> SuggestedQuestionTraceInfo:
        with tracing_store_errors(), self._sessions() as session:
            message = self._message_in_app(session, event, payload.message_id)
            workflow_app_log_id = self._workflow_app_log_id(session, message)
            end_user_session_id = self._end_user_session_id(session, message, event.tenant_id)
        metadata = {
            **self._correlation_metadata(event),
            **self._message_metadata(message),
            "user_id": message.from_end_user_id or message.from_account_id,
            "end_user_session_id": end_user_session_id,
        }
        return SuggestedQuestionTraceInfo(
            trace_id=event.correlation.external_trace_id,
            message_id=workflow_app_log_id or message.id,
            message_data=_trace_message(message),
            inputs=message.message,
            outputs=message.answer,
            start_time=payload.started_at,
            end_time=payload.ended_at,
            metadata=metadata,
            total_tokens=message.message_tokens + message.answer_tokens,
            status=message.status,
            error=message.error,
            from_account_id=message.from_account_id,
            agent_based=message.agent_based,
            from_source=message.from_source,
            model_provider=message.model_provider,
            model_id=message.model_id,
            suggested_question=payload.questions,
            level=message.status,
            status_message=message.error,
            workflow_run_id=None,
        )

    def _dataset_retrieval(self, event: TraceEvent, payload: DatasetRetrieved) -> DatasetRetrievalTraceInfo:
        dataset_ids: set[str] = set()
        for document in payload.documents:
            document_metadata = document.get("metadata")
            if isinstance(document_metadata, dict) and isinstance(document_metadata.get("dataset_id"), str):
                dataset_ids.add(str(document_metadata["dataset_id"]))
        with tracing_store_errors(), self._sessions() as session:
            message = self._message_in_app(session, event, payload.message_id)
            end_user_session_id = self._end_user_session_id(session, message, event.tenant_id)
            app_name, workspace_name = self._names(session, message.app_id, event.tenant_id)
            embedding_models = {
                str(row.id): {
                    "embedding_model": row.embedding_model or "",
                    "embedding_model_provider": row.embedding_model_provider or "",
                }
                for row in session.execute(
                    select(Dataset.id, Dataset.embedding_model, Dataset.embedding_model_provider).where(
                        Dataset.id.in_(sorted(dataset_ids)), Dataset.tenant_id == event.tenant_id
                    )
                )
            }
            inputs = message.query or message.inputs_with_session(session=session)
        metadata = {
            **self._correlation_metadata(event),
            **self._message_metadata(message),
            "tenant_id": event.tenant_id,
            "app_id": message.app_id,
            "user_id": message.from_end_user_id or message.from_account_id,
            "end_user_session_id": end_user_session_id,
            "app_name": app_name,
            "workspace_name": workspace_name,
            "embedding_models": embedding_models,
            "rerank_model_provider": "",
            "rerank_model_name": "",
        }
        return DatasetRetrievalTraceInfo(
            trace_id=event.correlation.external_trace_id,
            message_id=message.id,
            inputs=inputs,
            documents=payload.documents,
            start_time=payload.started_at,
            end_time=payload.ended_at,
            metadata=metadata,
            message_data=_trace_message(message),
            error=None,
        )

    def _tool(self, event: TraceEvent, payload: ToolInvoked) -> ToolTraceInfo:
        with tracing_store_errors(), self._sessions() as session:
            message = self._message_in_app(session, event, payload.message_id)
            message_file = session.scalar(select(MessageFile).where(MessageFile.message_id == message.id).limit(1))
            end_user_session_id = self._end_user_session_id(session, message, event.tenant_id)
        error = payload.error or None
        metadata: dict[str, Any] = {
            **self._correlation_metadata(event),
            "message_id": message.id,
            "tool_name": payload.tool_name,
            "tool_inputs": payload.tool_inputs,
            "tool_outputs": payload.tool_outputs,
            "tool_config": payload.tool_config,
            "time_cost": payload.time_cost,
            "error": error,
            "tool_parameters": payload.tool_inputs,
            "user_id": message.from_end_user_id or message.from_account_id,
            "end_user_session_id": end_user_session_id,
        }
        if message.workflow_run_id:
            metadata["workflow_run_id"] = message.workflow_run_id
        file_url = None
        if message_file is not None:
            file_url = f"{self._files_url}/{message_file.url}"
            metadata.update(
                {
                    "message_file_id": message_file.id,
                    "created_by_role": message_file.created_by_role,
                    "created_user_id": message_file.created_by,
                    "type": message_file.type,
                }
            )
        return ToolTraceInfo(
            trace_id=event.correlation.external_trace_id,
            message_id=message.id,
            message_data=_trace_message(message),
            tool_name=payload.tool_name,
            start_time=payload.started_at,
            end_time=payload.ended_at,
            tool_inputs=payload.tool_inputs,
            tool_outputs=payload.tool_outputs,
            metadata=metadata,
            error=error,
            inputs=message.message,
            outputs=message.answer,
            tool_config=payload.tool_config,
            time_cost=payload.time_cost,
            tool_parameters=payload.tool_inputs,
            file_url=file_url,
        )

    def _conversation_name(self, event: TraceEvent, payload: ConversationNamed) -> GenerateNameTraceInfo:
        with tracing_store_errors(), self._sessions() as session:
            if event.app_id is not None:
                self._app(session, event)
            message = (
                self._message_in_app(session, event, payload.message_id) if payload.message_id is not None else None
            )
        metadata = {
            **self._correlation_metadata(event),
            "conversation_id": payload.conversation_id,
            "tenant_id": event.tenant_id,
            "app_id": event.app_id,
            "user_id": event.user_id,
        }
        return GenerateNameTraceInfo(
            trace_id=event.correlation.external_trace_id,
            message_id=payload.message_id,
            message_data=_trace_message(message) if message is not None else None,
            conversation_id=payload.conversation_id,
            inputs=payload.inputs,
            outputs=payload.name,
            start_time=payload.started_at,
            end_time=payload.ended_at,
            metadata=metadata,
            tenant_id=event.tenant_id,
        )

    def _prompt_generation(self, event: TraceEvent, payload: PromptGenerated) -> PromptGenerationTraceInfo:
        with tracing_store_errors(), self._sessions() as session:
            if event.app_id is not None:
                self._app(session, event)
            app_name, workspace_name = self._names(session, event.app_id, event.tenant_id)
        user_id = event.user_id or ""
        metadata = {
            **self._correlation_metadata(event),
            "tenant_id": event.tenant_id,
            "user_id": user_id,
            "app_id": event.app_id or "",
            "app_name": app_name or None,
            "workspace_name": workspace_name or None,
            "operation_type": payload.operation_type,
            "model_provider": payload.model_provider,
            "model_name": payload.model_name,
        }
        return PromptGenerationTraceInfo(
            trace_id=event.correlation.external_trace_id,
            inputs=payload.instruction,
            outputs=payload.generated_output,
            start_time=payload.started_at,
            end_time=payload.ended_at,
            metadata=metadata,
            tenant_id=event.tenant_id,
            user_id=user_id,
            app_id=event.app_id,
            operation_type=payload.operation_type,
            instruction=payload.instruction,
            prompt_tokens=payload.prompt_tokens,
            completion_tokens=payload.completion_tokens,
            total_tokens=payload.total_tokens,
            model_provider=payload.model_provider,
            model_name=payload.model_name,
            latency=payload.latency,
            total_price=payload.total_price,
            currency=payload.currency,
            error=payload.error,
        )

    def _draft_node(self, event: TraceEvent, payload: DraftNodeExecuted) -> DraftNodeExecutionTrace:
        node = payload.node_execution
        if node.get("tenant_id") != event.tenant_id or node.get("app_id") != event.app_id:
            raise SourceNotFoundError
        with tracing_store_errors(), self._sessions() as session:
            app_name, workspace_name = self._names(session, event.app_id, event.tenant_id)
            credential_id, credential_name = self._credential(session, node, event.tenant_id)
        metadata: dict[str, Any] = {
            **self._correlation_metadata(event),
            "tenant_id": event.tenant_id,
            "app_id": event.app_id,
            "app_name": app_name,
            "workspace_name": workspace_name,
            "user_id": node.get("user_id"),
            "invoke_from": node.get("invoke_from"),
            "credential_id": credential_id,
            "credential_name": credential_name,
            "dataset_ids": node.get("dataset_ids"),
            "dataset_names": node.get("dataset_names"),
            "plugin_name": node.get("plugin_name"),
        }
        return DraftNodeExecutionTrace(
            trace_id=event.correlation.external_trace_id,
            start_time=_datetime(node.get("created_at")),
            end_time=_datetime(node.get("finished_at")),
            metadata=metadata,
            workflow_id=str(node.get("workflow_id") or ""),
            workflow_run_id=str(node.get("workflow_execution_id") or ""),
            tenant_id=event.tenant_id,
            node_execution_id=str(node.get("node_execution_id") or ""),
            node_id=str(node.get("node_id") or ""),
            node_type=str(node.get("node_type") or ""),
            title=str(node.get("title") or ""),
            status=str(node.get("status") or ""),
            error=_text(node.get("error")),
            elapsed_time=_number(node.get("elapsed_time")),
            index=int(_number(node.get("index"))),
            predecessor_node_id=_text(node.get("predecessor_node_id")),
            total_tokens=int(_number(node.get("total_tokens"))),
            total_price=_number(node.get("total_price")),
            currency=_text(node.get("currency")),
            model_provider=_text(node.get("model_provider")),
            model_name=_text(node.get("model_name")),
            prompt_tokens=_optional_int(node.get("prompt_tokens")),
            completion_tokens=_optional_int(node.get("completion_tokens")),
            tool_name=_text(node.get("tool_name")),
            iteration_id=_text(node.get("iteration_id")),
            iteration_index=_optional_int(node.get("iteration_index")),
            loop_id=_text(node.get("loop_id")),
            loop_index=_optional_int(node.get("loop_index")),
            parallel_id=_text(node.get("parallel_id")),
            node_inputs=_mapping(node.get("node_inputs")),
            node_outputs=_mapping(node.get("node_outputs")),
            process_data=_mapping(node.get("process_data")),
            invoked_by=_user_of(metadata),
        )

    def _credential(self, session: Session, node: Mapping[str, Any], tenant_id: str) -> tuple[str | None, str]:
        """Resolve the tool or model credential a node ran with, for enterprise telemetry only."""
        if not self._enterprise_details:
            return _text(node.get("credential_id")), ""
        credential_id = _text(node.get("credential_id"))
        if credential_id:
            model_class = _TOOL_PROVIDER_MODELS.get(str(node.get("credential_provider_type") or ""))
            if model_class is None:
                return credential_id, ""
            name = session.scalar(
                select(model_class.name).where(model_class.id == credential_id, model_class.tenant_id == tenant_id)
            )
            return credential_id, str(name or "")
        provider_name = _text(node.get("model_provider"))
        if not provider_name:
            return None, ""
        provider = session.scalar(
            select(Provider).where(
                Provider.tenant_id == tenant_id,
                Provider.provider_name == provider_name,
                Provider.provider_type == ProviderType.CUSTOM,
            )
        )
        if provider is None:
            return None, ""
        model_name = _text(node.get("model_name"))
        model = (
            session.scalar(
                select(ProviderModel).where(
                    ProviderModel.tenant_id == tenant_id,
                    ProviderModel.provider_name == provider_name,
                    ProviderModel.model_name == model_name,
                    ProviderModel.model_type == "llm",
                )
            )
            if model_name
            else None
        )
        if model is not None and model.credential_id:
            name = session.scalar(
                select(ProviderModelCredential.credential_name).where(
                    ProviderModelCredential.id == model.credential_id, ProviderModelCredential.tenant_id == tenant_id
                )
            )
            return model.credential_id, str(name or "")
        if provider.credential_id:
            name = session.scalar(
                select(ProviderCredential.credential_name).where(
                    ProviderCredential.id == provider.credential_id, ProviderCredential.tenant_id == tenant_id
                )
            )
            return provider.credential_id, str(name or "")
        return None, ""


def _text(value: object) -> str | None:
    return str(value) if value is not None and value != "" else None


def _number(value: object) -> float:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else 0.0


def _optional_int(value: object) -> int | None:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _mapping(value: object) -> Mapping[str, Any] | None:
    return value if isinstance(value, dict) else None


def _datetime(value: object) -> datetime | None:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None
