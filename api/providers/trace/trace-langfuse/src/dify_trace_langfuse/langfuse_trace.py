import base64
import hashlib
import logging
import os
import re
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, override

import httpx
from langfuse import __version__ as langfuse_version
from langfuse.api import LangfuseAPI
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, KeyValue
from opentelemetry.proto.trace.v1.trace_pb2 import Span, Status
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
from core.ops.utils import filter_none_values
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
from services.tracing.provider_common import json_value, nanos, utc

logger = logging.getLogger(__name__)

OTEL_TRACES_PATH = "/api/public/otel/v1/traces"
INGESTION_VERSION_HEADER = {"x-langfuse-ingestion-version": "4"}
SERVICE_NAME = "dify"
_HEX32 = re.compile(r"[0-9a-f]{32}")


def _otel_trace_id(key: str) -> bytes:
    """Matches later Dify versions, so IDs survive an upgrade."""
    candidate = key.replace("-", "").lower()
    if _HEX32.fullmatch(candidate) and int(candidate, 16):
        return bytes.fromhex(candidate)
    digest = hashlib.sha256(f"dify-trace:{key}".encode()).digest()[:16]
    return digest if any(digest) else bytes(15) + b"\x01"


def _otel_span_id(key: str) -> bytes:
    digest = hashlib.sha256(f"dify-application-span:{key}".encode()).digest()[:8]
    return digest if any(digest) else bytes(7) + b"\x01"


def _random_span_id() -> bytes:
    # The version nibble of a UUID4 keeps these bytes nonzero.
    return uuid.uuid4().bytes[:8]


def _json(value: Any) -> str | None:
    return None if value is None else json_value(value)


def _prefixed(prefix: str, metadata: Mapping[str, Any] | None) -> dict[str, Any]:
    return {f"{prefix}.{key}": value for key, value in (metadata or {}).items()}


def _attribute(key: str, value: object) -> KeyValue:
    if isinstance(value, bool):
        encoded = AnyValue(bool_value=value)
    elif isinstance(value, int):
        encoded = AnyValue(int_value=value)
    elif isinstance(value, float):
        encoded = AnyValue(double_value=value)
    elif isinstance(value, str):
        encoded = AnyValue(string_value=value)
    else:
        encoded = AnyValue(string_value=json_value(value))
    return KeyValue(key=key, value=encoded)


def _observation_attributes(data: LangfuseSpan | LangfuseGeneration, observation_type: str) -> dict[str, Any]:
    return {
        "langfuse.observation.type": observation_type,
        "langfuse.observation.input": _json(data.input),
        "langfuse.observation.output": _json(data.output),
        "langfuse.observation.level": data.level,
        "langfuse.observation.status_message": data.status_message,
        "langfuse.version": data.version,
        **_prefixed("langfuse.observation.metadata", data.metadata),
    }


class LangFuseDataTrace(BaseTraceInstance):
    def __init__(
        self,
        langfuse_config: LangfuseConfig,
    ):
        super().__init__(langfuse_config)
        timeout = int(os.environ.get("LANGFUSE_TIMEOUT", 5))
        self._http_client: httpx.Client | None = httpx.Client(timeout=timeout)
        self.langfuse_client = LangfuseAPI(
            base_url=langfuse_config.host,
            username=langfuse_config.public_key,
            password=langfuse_config.secret_key,
            x_langfuse_sdk_name="python",
            x_langfuse_sdk_version=langfuse_version,
            x_langfuse_public_key=langfuse_config.public_key,
            timeout=timeout,
            httpx_client=self._http_client,
        )
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")
        token = base64.b64encode(f"{langfuse_config.public_key}:{langfuse_config.secret_key}".encode()).decode()
        self._otel_url = f"{langfuse_config.host.rstrip('/')}{OTEL_TRACES_PATH}"
        self._otel_headers = {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/x-protobuf",
            **INGESTION_VERSION_HEADER,
        }

    def close(self) -> None:
        client = getattr(self, "_http_client", None)
        if client is None:
            return
        self._http_client = None
        try:
            client.close()
        except Exception:
            logger.debug("Failed to close Langfuse HTTP client", exc_info=True)

    def __del__(self) -> None:
        self.close()

    @staticmethod
    def _get_completion_start_time(
        start_time: datetime | None, time_to_first_token: float | int | None
    ) -> datetime | None:
        """Convert a relative TTFT value in seconds into Langfuse's absolute completion start time."""
        if start_time is None or time_to_first_token is None:
            return None

        try:
            ttft_seconds = float(time_to_first_token)
        except (TypeError, ValueError):
            return None

        if ttft_seconds < 0:
            return None

        return start_time + timedelta(seconds=ttft_seconds)

    @override
    def trace(self, trace_info: BaseTraceInfo):
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

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        trace_id = trace_info.trace_id or trace_info.workflow_run_id
        user_id = trace_info.metadata.get("user_id")
        metadata = trace_info.metadata
        metadata["workflow_app_log_id"] = trace_info.workflow_app_log_id

        if trace_info.message_id:
            # The message trace task of the same run sends this trace's root.
            trace_id = trace_info.trace_id or trace_info.message_id
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
                except Exception:
                    logger.error("Failed to extract usage", exc_info=True)

                # add generation
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
            id=trace_info.conversation_id,
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

    def _send(
        self,
        *,
        trace_key: str,
        span_id: bytes,
        parent_span_id: bytes | None,
        name: str | None,
        start_time: datetime | None,
        end_time: datetime | None,
        is_error: bool,
        attributes: Mapping[str, Any],
    ) -> None:
        client = self._http_client
        if client is None:
            raise RuntimeError("Langfuse client is closed")
        start_ns = nanos(start_time or datetime.now(UTC))
        request = ExportTraceServiceRequest()
        resource_spans = request.resource_spans.add()
        resource_spans.resource.attributes.append(_attribute("service.name", SERVICE_NAME))
        scope_spans = resource_spans.scope_spans.add()
        scope_spans.scope.name = SERVICE_NAME
        span = scope_spans.spans.add(
            trace_id=_otel_trace_id(trace_key),
            span_id=span_id,
            parent_span_id=parent_span_id or b"",
            name=name or "",
            kind=Span.SPAN_KIND_INTERNAL,
            start_time_unix_nano=start_ns,
            end_time_unix_nano=max(nanos(end_time), start_ns) if end_time else start_ns,
        )
        span.status.code = Status.STATUS_CODE_ERROR if is_error else Status.STATUS_CODE_OK
        span.attributes.extend(_attribute(key, value) for key, value in attributes.items() if value is not None)
        client.post(self._otel_url, headers=self._otel_headers, content=request.SerializeToString()).raise_for_status()

    def _send_observation(self, data: LangfuseSpan | LangfuseGeneration, attributes: Mapping[str, Any]) -> None:
        # Without a parent, the observation sits under the trace root.
        trace_key = data.trace_id or str(uuid.uuid4())
        self._send(
            trace_key=trace_key,
            span_id=_otel_span_id(data.id) if data.id else _random_span_id(),
            parent_span_id=_otel_span_id(data.parent_observation_id or trace_key),
            name=data.name,
            start_time=data.start_time,
            end_time=data.end_time,
            is_error=data.level == LevelEnum.ERROR,
            attributes=attributes,
        )

    def add_trace(self, langfuse_trace_data: LangfuseTrace | None = None):
        """OpenTelemetry has no trace record, so the trace becomes its root span."""
        data = langfuse_trace_data or LangfuseTrace()
        trace_key = data.id or str(uuid.uuid4())
        try:
            self._send(
                trace_key=trace_key,
                span_id=_otel_span_id(trace_key),
                parent_span_id=None,
                name=data.name,
                start_time=data.start_time,
                end_time=data.end_time,
                is_error=False,
                attributes={
                    "langfuse.trace.name": data.name,
                    "langfuse.user.id": data.user_id,
                    "langfuse.session.id": data.session_id,
                    "langfuse.trace.tags": data.tags,
                    "langfuse.trace.public": data.public,
                    "langfuse.version": data.version,
                    "langfuse.release": data.release,
                    "langfuse.observation.type": "span",
                    "langfuse.observation.input": _json(data.input),
                    "langfuse.observation.output": _json(data.output),
                    **_prefixed("langfuse.trace.metadata", data.metadata),
                },
            )
            logger.debug("LangFuse Trace created successfully")
        except Exception as e:
            raise ValueError(f"LangFuse Failed to create trace: {str(e)}") from e

    def add_span(self, langfuse_span_data: LangfuseSpan | None = None):
        data = langfuse_span_data or LangfuseSpan()
        try:
            self._send_observation(
                data,
                {
                    **_observation_attributes(data, "span"),
                    "langfuse.user.id": data.user_id,
                    "langfuse.session.id": data.session_id,
                },
            )
            logger.debug("LangFuse Span created successfully")
        except Exception as e:
            raise ValueError(f"LangFuse Failed to create span: {str(e)}") from e

    def update_span(self, span, langfuse_span_data: LangfuseSpan | None = None):
        format_span_data = filter_none_values(langfuse_span_data.model_dump()) if langfuse_span_data else {}

        span.end(**format_span_data)

    def add_generation(self, langfuse_generation_data: LangfuseGeneration | None = None):
        data = langfuse_generation_data or LangfuseGeneration()
        try:
            attributes = {
                **_observation_attributes(data, "generation"),
                "langfuse.observation.model.name": data.model,
                "langfuse.observation.model.parameters": _json(data.model_parameters),
                "langfuse.observation.completion_start_time": (
                    utc(data.completion_start_time).isoformat() if data.completion_start_time else None
                ),
            }
            usage = data.usage
            if usage is not None:
                attributes["langfuse.observation.usage_details"] = json_value(
                    {"input": usage.input or 0, "output": usage.output or 0, "total": usage.total or 0}
                )
                costs = {
                    key: float(value)
                    for key, value in (
                        ("input", usage.inputCost),
                        ("output", usage.outputCost),
                        ("total", usage.totalCost),
                    )
                    if value is not None
                }
                attributes["langfuse.observation.cost_details"] = json_value(costs) if costs else None
            self._send_observation(data, attributes)
            logger.debug("LangFuse Generation created successfully")
        except Exception as e:
            raise ValueError(f"LangFuse Failed to create generation: {str(e)}") from e

    def update_generation(self, generation, langfuse_generation_data: LangfuseGeneration | None = None):
        format_generation_data = (
            filter_none_values(langfuse_generation_data.model_dump()) if langfuse_generation_data else {}
        )

        generation.end(**format_generation_data)

    def api_check(self):
        try:
            projects = self.langfuse_client.projects.get()
        except Exception as e:
            logger.debug("LangFuse API check failed", exc_info=True)
            raise ValueError(f"LangFuse API check failed: {str(e)}") from e
        if not projects.data:
            raise ValueError("LangFuse API check failed: no project found for the provided credentials")
        return True

    def get_project_key(self):
        try:
            projects = self.langfuse_client.projects.get()
            return projects.data[0].id
        except Exception as e:
            logger.debug("LangFuse get project key failed", exc_info=True)
            raise ValueError(f"LangFuse get project key failed: {str(e)}") from e
