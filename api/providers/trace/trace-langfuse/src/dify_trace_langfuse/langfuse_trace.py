import hashlib
import json
import logging
import os
import re
import threading
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast, override

import httpx
from langfuse import Langfuse, LangfuseOtelSpanAttributes
from langfuse import LangfuseGeneration as LangfuseSdkGeneration
from langfuse import LangfuseSpan as LangfuseSdkSpan
from langfuse.api.core.api_error import ApiError
from opentelemetry import trace as otel_trace_api
from opentelemetry.context import Context
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.id_generator import RandomIdGenerator
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

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
from core.repositories import DifyCoreRepositoryFactory
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langfuse.entities.langfuse_trace_entity import (
    GenerationUsage,
    LangfuseGeneration,
    LangfuseSpan,
    LangfuseTrace,
    LevelEnum,
    UnitEnum,
)
from extensions.ext_database import db
from graphon.enums import BuiltinNodeTypes
from models import EndUser, WorkflowNodeExecutionTriggeredFrom
from models.enums import MessageStatus

logger = logging.getLogger(__name__)


_HEX_16 = re.compile(r"^[0-9a-f]{16}$")
_HEX_32 = re.compile(r"^[0-9a-f]{32}$")
_tracer_providers: dict[str, TracerProvider] = {}
_tracer_provider_settings: dict[str, tuple[str, bytes]] = {}
_tracer_providers_lock = threading.Lock()


class _ThreadLocalSeeds(threading.local):
    def __init__(self) -> None:
        self.trace_id: int | None = None
        self.span_id: int | None = None


class _SeededIdGenerator(RandomIdGenerator):
    def __init__(self) -> None:
        self._seeds = _ThreadLocalSeeds()

    def seed_next(self, *, trace_id: int | None = None, span_id: int | None = None) -> None:
        if trace_id is not None:
            self._seeds.trace_id = trace_id
        if span_id is not None:
            self._seeds.span_id = span_id

    @override
    def generate_trace_id(self) -> int:
        seeded = self._seeds.trace_id
        if seeded is not None:
            self._seeds.trace_id = None
            return seeded
        return super().generate_trace_id()

    @override
    def generate_span_id(self) -> int:
        seeded = self._seeds.span_id
        if seeded is not None:
            self._seeds.span_id = None
            return seeded
        return super().generate_span_id()


def _tracer_provider_for(public_key: str, host: str, secret_key: str) -> TracerProvider:
    """Bind connection settings before SDK construction can create its public-key singleton."""
    settings = (host.rstrip("/"), hashlib.sha256(secret_key.encode("utf-8")).digest())
    with _tracer_providers_lock:
        existing = _tracer_provider_settings.get(public_key)
        if existing is not None and existing != settings:
            raise ValueError("Langfuse public key is already initialized with different connection settings")
        provider = _tracer_providers.get(public_key)
        if provider is None:
            provider = TracerProvider(
                resource=Resource.create({"service.name": "dify-langfuse-app-trace"}),
                id_generator=_SeededIdGenerator(),
            )
            _tracer_providers[public_key] = provider
        _tracer_provider_settings[public_key] = settings
        return provider


def _deterministic_trace_id(seed: str) -> str:
    normalized = seed.replace("-", "").lower()
    if _HEX_32.fullmatch(normalized):
        return normalized
    return hashlib.sha256(seed.encode("utf-8")).digest()[:16].hex()


def _deterministic_span_id(seed: str) -> str:
    normalized = seed.replace("-", "").lower()
    if _HEX_16.fullmatch(normalized):
        return normalized
    if _HEX_32.fullmatch(normalized):
        return normalized[:16]
    return hashlib.sha256(seed.encode("utf-8")).digest()[:8].hex()


def _root_span_id(trace_id: str) -> str:
    return hashlib.sha256(f"root:{trace_id}".encode()).digest()[:8].hex()


def _to_ns(moment: datetime) -> int:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return int(moment.timestamp() * 1_000_000_000)


def _json_str(value: Any) -> str:
    return json.dumps(value)


def _usage_details(usage: GenerationUsage | None) -> dict[str, int] | None:
    if usage is None:
        return None
    details = {
        "input": usage.input if usage.input is not None else usage.promptTokens,
        "output": usage.output if usage.output is not None else usage.completionTokens,
        "total": usage.total,
    }
    filtered = {key: value for key, value in details.items() if value is not None}
    return filtered or None


def _cost_details(usage: GenerationUsage | None) -> dict[str, float] | None:
    if usage is None:
        return None
    details = {
        "input": usage.inputCost,
        "output": usage.outputCost,
        "total": usage.totalCost,
    }
    filtered = {key: value for key, value in details.items() if value is not None}
    return filtered or None


def _span_level(level: LevelEnum | None) -> Literal["DEBUG", "DEFAULT", "ERROR", "WARNING"] | None:
    if level is None:
        return None
    return cast(Literal["DEBUG", "DEFAULT", "ERROR", "WARNING"], level.value)


class LangFuseDataTrace(BaseTraceInstance):
    def __init__(
        self,
        langfuse_config: LangfuseConfig,
    ):
        super().__init__(langfuse_config)
        timeout = int(os.environ.get("LANGFUSE_TIMEOUT", 5))
        self._tracer_provider = _tracer_provider_for(
            langfuse_config.public_key, langfuse_config.host, langfuse_config.secret_key
        )
        self._closed = False
        try:
            self.langfuse_client = Langfuse(
                public_key=langfuse_config.public_key,
                secret_key=langfuse_config.secret_key,
                host=langfuse_config.host,
                timeout=timeout,
                tracer_provider=self._tracer_provider,
            )
        except (ApiError, httpx.HTTPError, OSError, RuntimeError, TypeError, ValueError):
            logger.exception(
                "Langfuse client initialization failed host=%s public_key=%s",
                langfuse_config.host,
                langfuse_config.public_key,
            )
            raise
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")

    def close(self) -> None:
        if self._closed:
            return
        self._flush("close")
        self._closed = True

    def _flush(self, operation: str, trace_type: str | None = None) -> None:
        try:
            self.langfuse_client.flush()
        except Exception:
            logger.exception("Langfuse flush failed operation=%s trace_type=%s", operation, trace_type)
            raise

    @staticmethod
    def _get_completion_start_time(
        start_time: datetime | None, time_to_first_token: float | int | None
    ) -> datetime | None:
        """Convert a relative TTFT value in seconds into Langfuse's absolute completion start time."""
        if start_time is None or time_to_first_token is None:
            return None

        try:
            ttft_seconds = float(time_to_first_token)
        except (OverflowError, TypeError, ValueError):
            logger.warning("Ignoring invalid Langfuse time_to_first_token value")
            return None

        if ttft_seconds < 0:
            logger.warning("Ignoring negative Langfuse time_to_first_token value")
            return None

        return start_time + timedelta(seconds=ttft_seconds)

    @override
    def trace(self, trace_info: BaseTraceInfo):
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
                    raise TypeError(f"Unsupported trace info type: {type(trace_info).__name__}")
        except (
            ApiError,
            AttributeError,
            httpx.HTTPError,
            IndexError,
            KeyError,
            OSError,
            OverflowError,
            RuntimeError,
            SQLAlchemyError,
            TypeError,
            ValueError,
        ) as trace_error:
            logger.exception(
                "Langfuse trace dispatch failed trace_type=%s trace_id=%s message_id=%s",
                type(trace_info).__name__,
                getattr(trace_info, "trace_id", None),
                getattr(trace_info, "message_id", None),
            )
            try:
                self._flush("trace_error", type(trace_info).__name__)
            except Exception as flush_error:
                trace_error.add_note(f"Langfuse flush also failed: {flush_error}")
            raise
        else:
            self._flush("trace", type(trace_info).__name__)

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        trace_id = trace_info.trace_id or trace_info.workflow_run_id
        user_id = trace_info.metadata.get("user_id")
        metadata = trace_info.metadata
        metadata["workflow_app_log_id"] = trace_info.workflow_app_log_id

        if trace_info.message_id:
            trace_id = trace_info.trace_id or trace_info.message_id
            name = TraceTaskName.MESSAGE_TRACE
            trace_data = LangfuseTrace(
                id=trace_id,
                user_id=user_id,
                name=name,
                input=dict(trace_info.workflow_run_inputs),
                output=dict(trace_info.workflow_run_outputs),
                metadata=metadata,
                session_id=trace_info.conversation_id,
                tags=["message", "workflow"],
                version=trace_info.workflow_run_version,
                start_time=trace_info.start_time,
                end_time=trace_info.end_time,
            )
            self.add_trace(langfuse_trace_data=trace_data)
            workflow_span_data = LangfuseSpan(
                id=trace_info.workflow_run_id,
                name=TraceTaskName.WORKFLOW_TRACE,
                input=dict(trace_info.workflow_run_inputs),
                output=dict(trace_info.workflow_run_outputs),
                trace_id=trace_id,
                start_time=trace_info.start_time,
                end_time=trace_info.end_time,
                metadata=metadata,
                level=LevelEnum.DEFAULT if trace_info.error == "" else LevelEnum.ERROR,
                status_message=trace_info.error or "",
            )
            self.add_span(langfuse_span_data=workflow_span_data)
        else:
            trace_data = LangfuseTrace(
                id=trace_id,
                user_id=user_id,
                name=TraceTaskName.WORKFLOW_TRACE,
                input=dict(trace_info.workflow_run_inputs),
                output=dict(trace_info.workflow_run_outputs),
                metadata=metadata,
                session_id=trace_info.conversation_id,
                tags=["workflow"],
                version=trace_info.workflow_run_version,
                start_time=trace_info.start_time,
                end_time=trace_info.end_time,
            )
            self.add_trace(langfuse_trace_data=trace_data)

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
            metadata = {str(k): v for k, v in execution_metadata.items()}
            metadata.update(
                {
                    "workflow_run_id": trace_info.workflow_run_id,
                    "node_execution_id": node_execution_id,
                    "tenant_id": tenant_id,
                    "app_id": app_id,
                    "node_name": node_name,
                    "node_type": node_type,
                    "status": status,
                }
            )
            process_data = node_execution.process_data or {}
            model_provider = process_data.get("model_provider", None)
            model_name = process_data.get("model_name", None)
            if model_provider is not None and model_name is not None:
                metadata.update(
                    {
                        "model_provider": model_provider,
                        "model_name": model_name,
                    }
                )

            # add generation span
            if process_data and process_data.get("model_mode") == "chat":
                total_token = metadata.get("total_tokens", 0)
                prompt_tokens = 0
                completion_tokens = 0
                completion_start_time = None
                generation_usage = None
                try:
                    usage_data = process_data.get("usage")
                    if not isinstance(usage_data, dict):
                        usage_data = outputs.get("usage")
                    if not isinstance(usage_data, dict):
                        usage_data = {}
                    prompt_tokens = usage_data.get("prompt_tokens", 0)
                    completion_tokens = usage_data.get("completion_tokens", 0)
                    completion_start_time = self._get_completion_start_time(
                        created_at, usage_data.get("time_to_first_token")
                    )
                except (AttributeError, OverflowError, TypeError, ValueError):
                    logger.exception(
                        "Failed to extract usage for workflow_run_id=%s node_execution_id=%s",
                        trace_info.workflow_run_id,
                        node_execution_id,
                    )
                else:
                    generation_usage = GenerationUsage(
                        input=prompt_tokens,
                        output=completion_tokens,
                        total=total_token,
                        unit=UnitEnum.TOKENS,
                    )

                node_generation_data = LangfuseGeneration(
                    id=node_execution_id,
                    name=node_name,
                    trace_id=trace_id,
                    model=process_data.get("model_name"),
                    start_time=created_at,
                    completion_start_time=completion_start_time,
                    end_time=finished_at,
                    input=inputs,
                    output=outputs,
                    metadata=metadata,
                    level=(LevelEnum.DEFAULT if status == "succeeded" else LevelEnum.ERROR),
                    status_message=trace_info.error or "",
                    parent_observation_id=trace_info.workflow_run_id if trace_info.message_id else None,
                    usage=generation_usage,
                )

                self.add_generation(langfuse_generation_data=node_generation_data)

            # add normal span
            else:
                span_data = LangfuseSpan(
                    id=node_execution_id,
                    name=node_name,
                    input=inputs,
                    output=outputs,
                    trace_id=trace_id,
                    start_time=created_at,
                    end_time=finished_at,
                    metadata=metadata,
                    level=(LevelEnum.DEFAULT if status == "succeeded" else LevelEnum.ERROR),
                    status_message=trace_info.error or "",
                    parent_observation_id=trace_info.workflow_run_id if trace_info.message_id else None,
                )

                self.add_span(langfuse_span_data=span_data)

    def message_trace(self, trace_info: MessageTraceInfo, **kwargs):
        # get message file data
        file_list = trace_info.file_list
        metadata = trace_info.metadata
        message_data = trace_info.message_data
        if message_data is None:
            logger.warning(
                "Skipping Langfuse message trace: message_data missing trace_id=%s message_id=%s",
                trace_info.trace_id,
                trace_info.message_id,
            )
            return
        message_id = message_data.id

        user_id = message_data.from_account_id
        if message_data.from_end_user_id:
            end_user_data: EndUser | None = db.session.get(EndUser, message_data.from_end_user_id)
            if end_user_data is not None:
                user_id = end_user_data.session_id
                metadata["user_id"] = user_id

        trace_id = trace_info.trace_id or message_id

        trace_data = LangfuseTrace(
            id=trace_id,
            user_id=user_id,
            name=TraceTaskName.MESSAGE_TRACE,
            input={
                "message": trace_info.inputs,
                "files": file_list,
                "message_tokens": trace_info.message_tokens,
                "answer_tokens": trace_info.answer_tokens,
                "total_tokens": trace_info.total_tokens,
                "error": trace_info.error,
                "provider_response_latency": message_data.provider_response_latency,
                "created_at": trace_info.start_time,
            },
            output=trace_info.outputs,
            metadata=metadata,
            session_id=message_data.conversation_id,
            tags=["message", str(trace_info.conversation_mode)],
            version=None,
            release=None,
            public=None,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
        )
        self.add_trace(langfuse_trace_data=trace_data)

        # add generation
        generation_usage = GenerationUsage(
            input=trace_info.message_tokens,
            output=trace_info.answer_tokens,
            total=trace_info.total_tokens,
            unit=UnitEnum.TOKENS,
            totalCost=message_data.total_price,
        )
        completion_start_time = self._get_completion_start_time(
            trace_info.start_time,
            trace_info.gen_ai_server_time_to_first_token,
        )

        langfuse_generation_data = LangfuseGeneration(
            name="llm",
            trace_id=trace_id,
            start_time=trace_info.start_time,
            completion_start_time=completion_start_time,
            end_time=trace_info.end_time,
            model=message_data.model_id,
            input=trace_info.inputs,
            output=message_data.answer,
            metadata=metadata,
            level=(LevelEnum.DEFAULT if message_data.status != MessageStatus.ERROR else LevelEnum.ERROR),
            status_message=message_data.error or "",
            usage=generation_usage,
        )

        self.add_generation(langfuse_generation_data)

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            logger.warning(
                "Skipping Langfuse moderation trace: message_data missing trace_id=%s message_id=%s",
                trace_info.trace_id,
                trace_info.message_id,
            )
            return
        span_data = LangfuseSpan(
            name=TraceTaskName.MODERATION_TRACE,
            input=trace_info.inputs,
            output={
                "action": trace_info.action,
                "flagged": trace_info.flagged,
                "preset_response": trace_info.preset_response,
                "inputs": trace_info.inputs,
            },
            trace_id=trace_info.trace_id or trace_info.message_id,
            start_time=trace_info.start_time or trace_info.message_data.created_at,
            end_time=trace_info.end_time or trace_info.message_data.created_at,
            metadata=trace_info.metadata,
        )

        self.add_span(langfuse_span_data=span_data)

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        message_data = trace_info.message_data
        if message_data is None:
            logger.warning(
                "Skipping Langfuse suggested-question trace: message_data missing trace_id=%s message_id=%s",
                trace_info.trace_id,
                trace_info.message_id,
            )
            return
        generation_usage = GenerationUsage(
            total=len(str(trace_info.suggested_question)),
            input=len(trace_info.inputs) if trace_info.inputs else 0,
            output=len(trace_info.suggested_question),
            unit=UnitEnum.CHARACTERS,
        )

        generation_data = LangfuseGeneration(
            name=TraceTaskName.SUGGESTED_QUESTION_TRACE,
            input=trace_info.inputs,
            output=str(trace_info.suggested_question),
            trace_id=trace_info.trace_id or trace_info.message_id,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
            metadata=trace_info.metadata,
            level=(LevelEnum.DEFAULT if message_data.status != MessageStatus.ERROR else LevelEnum.ERROR),
            status_message=message_data.error or "",
            usage=generation_usage,
        )

        self.add_generation(langfuse_generation_data=generation_data)

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            logger.warning(
                "Skipping Langfuse dataset-retrieval trace: message_data missing trace_id=%s message_id=%s",
                trace_info.trace_id,
                trace_info.message_id,
            )
            return
        dataset_retrieval_span_data = LangfuseSpan(
            name=TraceTaskName.DATASET_RETRIEVAL_TRACE,
            input=trace_info.inputs,
            output={"documents": trace_info.documents},
            trace_id=trace_info.trace_id or trace_info.message_id,
            start_time=trace_info.start_time or trace_info.message_data.created_at,
            end_time=trace_info.end_time or trace_info.message_data.updated_at,
            metadata=trace_info.metadata,
        )

        self.add_span(langfuse_span_data=dataset_retrieval_span_data)

    def tool_trace(self, trace_info: ToolTraceInfo):
        tool_span_data = LangfuseSpan(
            name=trace_info.tool_name,
            input=trace_info.tool_inputs,
            output=trace_info.tool_outputs,
            trace_id=trace_info.trace_id or trace_info.message_id,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
            metadata=trace_info.metadata,
            level=(LevelEnum.DEFAULT if trace_info.error == "" or trace_info.error is None else LevelEnum.ERROR),
            status_message=trace_info.error,
        )

        self.add_span(langfuse_span_data=tool_span_data)

    def generate_name_trace(self, trace_info: GenerateNameTraceInfo):
        name_generation_trace_data = LangfuseTrace(
            name=TraceTaskName.GENERATE_NAME_TRACE,
            input=trace_info.inputs,
            output=trace_info.outputs,
            user_id=trace_info.tenant_id,
            metadata=trace_info.metadata,
            session_id=trace_info.conversation_id,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
        )

        self.add_trace(langfuse_trace_data=name_generation_trace_data)

        name_generation_span_data = LangfuseSpan(
            name=TraceTaskName.GENERATE_NAME_TRACE,
            input=trace_info.inputs,
            output=trace_info.outputs,
            trace_id=trace_info.conversation_id,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
            metadata=trace_info.metadata,
        )
        self.add_span(langfuse_span_data=name_generation_span_data)

    def _seed_ids(self, *, trace_id: int | None = None, span_id: int | None = None) -> None:
        id_generator = self._tracer_provider.id_generator
        if isinstance(id_generator, _SeededIdGenerator):
            id_generator.seed_next(trace_id=trace_id, span_id=span_id)

    def _backdated_otel_span(self, *, name: str, start_time: datetime, context: Context):
        return self.langfuse_client._otel_tracer.start_span(
            name=name,
            context=context,
            start_time=_to_ns(start_time),
        )

    @staticmethod
    def _parent_context(trace_id: str, parent_span_id: str) -> Context:
        parent = NonRecordingSpan(
            SpanContext(
                trace_id=int(trace_id, 16),
                span_id=int(parent_span_id, 16),
                is_remote=False,
                trace_flags=TraceFlags(TraceFlags.SAMPLED),
            )
        )
        return otel_trace_api.set_span_in_context(parent, Context())

    @staticmethod
    def _trace_attributes(data: LangfuseTrace) -> dict[str, Any]:
        attributes: dict[str, Any] = {}
        if data.name:
            attributes[LangfuseOtelSpanAttributes.TRACE_NAME] = str(data.name)
        if data.user_id:
            attributes[LangfuseOtelSpanAttributes.TRACE_USER_ID] = data.user_id
        if data.session_id:
            attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID] = data.session_id
        if data.tags:
            attributes[LangfuseOtelSpanAttributes.TRACE_TAGS] = [str(tag) for tag in data.tags]
        if data.public is not None:
            attributes[LangfuseOtelSpanAttributes.TRACE_PUBLIC] = data.public
        if data.version:
            attributes[LangfuseOtelSpanAttributes.VERSION] = data.version
        if data.release:
            attributes[LangfuseOtelSpanAttributes.RELEASE] = data.release
        if data.input is not None:
            attributes[LangfuseOtelSpanAttributes.TRACE_INPUT] = _json_str(data.input)
        if data.output is not None:
            attributes[LangfuseOtelSpanAttributes.TRACE_OUTPUT] = _json_str(data.output)
        for key, value in (data.metadata or {}).items():
            attributes[f"{LangfuseOtelSpanAttributes.TRACE_METADATA}.{key}"] = (
                value if isinstance(value, str) else _json_str(value)
            )
        return attributes

    def add_trace(self, langfuse_trace_data: LangfuseTrace | None = None):
        data = langfuse_trace_data or LangfuseTrace()
        try:
            trace_id = _deterministic_trace_id(data.id or uuid.uuid4().hex)
            start_time = data.start_time or datetime.now(UTC)
            end_time = data.end_time or start_time
            self._seed_ids(trace_id=int(trace_id, 16), span_id=int(_root_span_id(trace_id), 16))
            otel_span = self._backdated_otel_span(
                name=str(data.name) if data.name else "trace",
                start_time=start_time,
                context=Context(),
            )
            for key, value in self._trace_attributes(data).items():
                otel_span.set_attribute(key, value)
            span = LangfuseSdkSpan(
                otel_span=otel_span,
                langfuse_client=self.langfuse_client,
                input=data.input,
                output=data.output,
                metadata=data.metadata,
                version=data.version,
                release=data.release,
            )
            span.end(end_time=_to_ns(end_time))
        except (OverflowError, RuntimeError, TypeError, ValueError):
            logger.exception("Langfuse trace write failed trace_id=%s", data.id)
            raise
        logger.debug("LangFuse Trace created successfully")

    def add_span(self, langfuse_span_data: LangfuseSpan | None = None):
        data = langfuse_span_data or LangfuseSpan()
        try:
            trace_id = _deterministic_trace_id(data.trace_id or data.id or uuid.uuid4().hex)
            parent_span_id = (
                _deterministic_span_id(data.parent_observation_id)
                if data.parent_observation_id
                else _root_span_id(trace_id)
            )
            if data.id:
                self._seed_ids(span_id=int(_deterministic_span_id(data.id), 16))
            start_time = data.start_time or datetime.now(UTC)
            otel_span = self._backdated_otel_span(
                name=str(data.name) if data.name else "span",
                start_time=start_time,
                context=self._parent_context(trace_id, parent_span_id),
            )
            span = LangfuseSdkSpan(
                otel_span=otel_span,
                langfuse_client=self.langfuse_client,
                input=data.input,
                output=data.output,
                metadata=data.metadata,
                version=data.version,
                level=_span_level(data.level),
                status_message=data.status_message,
            )
            span.end(end_time=_to_ns(data.end_time or start_time))
        except (OverflowError, RuntimeError, TypeError, ValueError):
            logger.exception("Langfuse span write failed trace_id=%s span_id=%s", data.trace_id, data.id)
            raise
        logger.debug("LangFuse Span created successfully")

    def add_generation(self, langfuse_generation_data: LangfuseGeneration | None = None):
        data = langfuse_generation_data or LangfuseGeneration()
        try:
            trace_id = _deterministic_trace_id(data.trace_id or data.id or uuid.uuid4().hex)
            parent_span_id = (
                _deterministic_span_id(data.parent_observation_id)
                if data.parent_observation_id
                else _root_span_id(trace_id)
            )
            if data.id:
                self._seed_ids(span_id=int(_deterministic_span_id(data.id), 16))
            start_time = data.start_time or datetime.now(UTC)
            otel_span = self._backdated_otel_span(
                name=str(data.name) if data.name else "generation",
                start_time=start_time,
                context=self._parent_context(trace_id, parent_span_id),
            )
            generation = LangfuseSdkGeneration(
                otel_span=otel_span,
                langfuse_client=self.langfuse_client,
                input=data.input,
                output=data.output,
                metadata=data.metadata,
                version=data.version,
                level=_span_level(data.level),
                status_message=data.status_message,
                completion_start_time=data.completion_start_time,
                model=data.model,
                model_parameters=data.model_parameters,
                usage_details=_usage_details(data.usage),
                cost_details=_cost_details(data.usage),
            )
            generation.end(end_time=_to_ns(data.end_time or start_time))
        except (OverflowError, RuntimeError, TypeError, ValueError):
            logger.exception("Langfuse generation write failed trace_id=%s generation_id=%s", data.trace_id, data.id)
            raise
        logger.debug("LangFuse Generation created successfully")

    def api_check(self):
        try:
            projects = self.langfuse_client.api.projects.get()
        except (ApiError, httpx.HTTPError) as e:
            logger.exception("LangFuse API check failed")
            raise ValueError("LangFuse API check failed; verify the configured host and credentials") from e
        if not projects.data:
            raise ValueError("LangFuse API check failed: no project found for the provided credentials")
        return True

    def get_project_key(self):
        try:
            projects = self.langfuse_client.api.projects.get()
        except (ApiError, httpx.HTTPError) as e:
            logger.exception("LangFuse get project key failed")
            raise ValueError("LangFuse get project key failed; verify the configured host and credentials") from e
        if not projects.data:
            raise ValueError("LangFuse get project key failed: no project found for the provided credentials")
        return projects.data[0].id
