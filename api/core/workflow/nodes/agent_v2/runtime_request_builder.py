from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

from dify_agent.protocol import CreateRunRequest, ExecutionContext

from clients.agent_backend import (
    AgentBackendModelConfig,
    AgentBackendOutputConfig,
    AgentBackendRunRequestBuilder,
    AgentBackendWorkflowNodeRunInput,
    redact_for_agent_backend_log,
)
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.variables.segments import Segment
from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
from models.agent_config_entities import (
    AgentSoulConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
)

from .runtime_feature_manifest import build_runtime_feature_manifest


class WorkflowAgentRuntimeRequestBuildError(ValueError):
    """Raised when workflow state cannot be mapped to a valid Agent backend run request."""

    def __init__(self, error_code: str, message: str) -> None:
        self.error_code = error_code
        super().__init__(message)


class VariablePoolReader(Protocol):
    def get(self, selector: Sequence[str], /) -> Segment | None: ...

    def get_by_prefix(self, prefix: str, /) -> Mapping[str, object]: ...


class CredentialsProvider(Protocol):
    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]: ...


@dataclass(frozen=True, slots=True)
class WorkflowAgentRuntimeBuildContext:
    dify_context: DifyRunContext
    workflow_id: str
    workflow_run_id: str | None
    node_id: str
    node_execution_id: str
    variable_pool: VariablePoolReader
    binding: WorkflowAgentNodeBinding
    agent: Agent
    snapshot: AgentConfigSnapshot


@dataclass(frozen=True, slots=True)
class WorkflowAgentRuntimeRequest:
    request: CreateRunRequest
    redacted_request: dict[str, Any]
    agent_soul: AgentSoulConfig
    node_job: WorkflowNodeJobConfig
    metadata: dict[str, Any]


class WorkflowAgentRuntimeRequestBuilder:
    """Build public Dify Agent run requests from workflow Agent v2 runtime state."""

    def __init__(
        self,
        *,
        credentials_provider: CredentialsProvider,
        request_builder: AgentBackendRunRequestBuilder | None = None,
    ) -> None:
        self._credentials_provider = credentials_provider
        self._request_builder = request_builder or AgentBackendRunRequestBuilder()

    def build(self, context: WorkflowAgentRuntimeBuildContext) -> WorkflowAgentRuntimeRequest:
        agent_soul = AgentSoulConfig.model_validate(context.snapshot.config_snapshot_dict)
        node_job = WorkflowNodeJobConfig.model_validate(context.binding.node_job_config_dict)
        if agent_soul.model is None:
            raise WorkflowAgentRuntimeRequestBuildError(
                "agent_model_not_configured",
                "Workflow Agent node requires Agent Soul model config.",
            )

        metadata = self._build_metadata(context, agent_soul, node_job)
        workflow_context_prompt = self._build_workflow_context_prompt(context, node_job)
        workflow_job_prompt = node_job.workflow_prompt.strip() or "Run this workflow Agent Node for the current run."
        user_prompt = workflow_context_prompt.strip() or "Use the current workflow context."
        credentials = self._credentials_provider.fetch(agent_soul.model.model_provider, agent_soul.model.model)

        request = self._request_builder.build_for_workflow_node(
            AgentBackendWorkflowNodeRunInput(
                model=AgentBackendModelConfig(
                    tenant_id=context.dify_context.tenant_id,
                    plugin_id=agent_soul.model.plugin_id,
                    model_provider=agent_soul.model.model_provider,
                    model=agent_soul.model.model,
                    user_id=context.dify_context.user_id,
                    credentials=self._normalize_credentials(credentials),
                    model_settings=cast(dict[str, Any], agent_soul.model.model_settings),
                ),
                execution_context=ExecutionContext(
                    tenant_id=context.dify_context.tenant_id,
                    app_id=context.dify_context.app_id,
                    workflow_id=context.workflow_id,
                    workflow_run_id=context.workflow_run_id,
                    node_id=context.node_id,
                    node_execution_id=context.node_execution_id,
                    conversation_id=get_system_text(context.variable_pool, SystemVariableKey.CONVERSATION_ID),
                    agent_id=context.agent.id,
                    agent_config_version_id=context.snapshot.id,
                    invoke_from=self._agent_backend_invoke_from(context.dify_context.invoke_from),
                ),
                agent_soul_prompt=agent_soul.prompt.system_prompt or None,
                workflow_node_job_prompt=workflow_job_prompt,
                user_prompt=user_prompt,
                output=self._build_output_config(node_job.declared_outputs),
                idempotency_key=self._idempotency_key(context),
                metadata=metadata,
            )
        )
        redacted = cast(dict[str, Any], redact_for_agent_backend_log(request))
        return WorkflowAgentRuntimeRequest(
            request=request,
            redacted_request=redacted,
            agent_soul=agent_soul,
            node_job=node_job,
            metadata=metadata,
        )

    @staticmethod
    def _agent_backend_invoke_from(invoke_from: InvokeFrom) -> Literal["workflow_run", "single_step"]:
        if invoke_from in {InvokeFrom.DEBUGGER, InvokeFrom.VALIDATION}:
            return "single_step"
        return "workflow_run"

    @staticmethod
    def _idempotency_key(context: WorkflowAgentRuntimeBuildContext) -> str:
        if context.workflow_run_id:
            return f"{context.workflow_run_id}:{context.node_execution_id}"
        return context.node_execution_id

    @staticmethod
    def _build_metadata(
        context: WorkflowAgentRuntimeBuildContext,
        agent_soul: AgentSoulConfig,
        node_job: WorkflowNodeJobConfig,
    ) -> dict[str, Any]:
        return {
            "tenant_id": context.dify_context.tenant_id,
            "app_id": context.dify_context.app_id,
            "workflow_id": context.workflow_id,
            "workflow_run_id": context.workflow_run_id,
            "node_id": context.node_id,
            "node_execution_id": context.node_execution_id,
            "agent_id": context.agent.id,
            "agent_config_snapshot_id": context.snapshot.id,
            "binding_id": context.binding.id,
            "workflow_node_job_mode": node_job.mode.value,
            "runtime_support": build_runtime_feature_manifest(agent_soul),
        }

    def _build_workflow_context_prompt(
        self,
        context: WorkflowAgentRuntimeBuildContext,
        node_job: WorkflowNodeJobConfig,
    ) -> str:
        lines = ["Workflow context loaded for this run:"]
        query = get_system_text(context.variable_pool, SystemVariableKey.QUERY)
        if query:
            lines.append(f"- User query: {query}")

        resolved_outputs = self._resolve_previous_node_outputs(
            context.variable_pool,
            node_job.previous_node_output_refs,
        )
        if resolved_outputs:
            lines.append("- Previous node outputs:")
            for item in resolved_outputs:
                lines.append(f"  - {item['label']}: {item['value']}")

        lines.append("The above workflow context is run-specific. Do not treat it as Agent Soul or persistent memory.")
        return "\n".join(lines)

    def _resolve_previous_node_outputs(
        self,
        variable_pool: VariablePoolReader,
        refs: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        resolved: list[dict[str, Any]] = []
        for ref in refs:
            selector = self._selector_from_ref(ref)
            if not selector:
                raise WorkflowAgentRuntimeRequestBuildError(
                    "invalid_previous_node_output_ref",
                    "Workflow Agent node has invalid previous node output ref.",
                )
            segment = variable_pool.get(selector)
            if segment is None:
                raise WorkflowAgentRuntimeRequestBuildError(
                    "missing_previous_node_output",
                    f"Workflow Agent node cannot resolve previous node output {'.'.join(selector)}.",
                )
            value = getattr(segment, "value", None)
            resolved.append(
                {
                    "label": ".".join(selector),
                    "value": self._summarize_value(value),
                }
            )
        return resolved

    @staticmethod
    def _selector_from_ref(ref: Mapping[str, Any]) -> list[str] | None:
        for key in ("selector", "variable_selector", "value_selector"):
            value = ref.get(key)
            if isinstance(value, list) and all(isinstance(item, str) for item in value):
                return value
        node_id = ref.get("node_id")
        output_name = ref.get("output") or ref.get("name") or ref.get("variable") or ref.get("key")
        if isinstance(node_id, str) and isinstance(output_name, str):
            return [node_id, output_name]
        return None

    @staticmethod
    def _summarize_value(value: Any) -> str:
        text = str(value)
        if len(text) > 2000:
            return text[:2000] + "...[truncated]"
        return text

    @staticmethod
    def _build_output_config(declared_outputs: Sequence[DeclaredOutputConfig]) -> AgentBackendOutputConfig | None:
        if not declared_outputs:
            return None
        properties: dict[str, Any] = {}
        required: list[str] = []
        for output in declared_outputs:
            properties[output.name] = WorkflowAgentRuntimeRequestBuilder._schema_for_declared_output(output)
            if output.required:
                required.append(output.name)
        schema: dict[str, Any] = {"type": "object", "properties": properties}
        if required:
            schema["required"] = required
        return AgentBackendOutputConfig(json_schema=schema)

    @staticmethod
    def _schema_for_declared_output(output: DeclaredOutputConfig) -> dict[str, Any]:
        match output.type:
            case DeclaredOutputType.STRING:
                schema: dict[str, Any] = {"type": "string"}
            case DeclaredOutputType.NUMBER:
                schema = {"type": "number"}
            case DeclaredOutputType.BOOLEAN:
                schema = {"type": "boolean"}
            case DeclaredOutputType.OBJECT:
                schema = {"type": "object"}
            case DeclaredOutputType.ARRAY:
                schema = {"type": "array"}
            case DeclaredOutputType.FILE:
                schema = {
                    "type": "object",
                    "properties": {
                        "file_id": {"type": "string"},
                        "filename": {"type": "string"},
                        "mime_type": {"type": "string"},
                        "url": {"type": "string"},
                    },
                }
        if output.description:
            schema["description"] = output.description
        return schema

    @staticmethod
    def _normalize_credentials(credentials: Mapping[str, Any]) -> dict[str, str | int | float | bool | None]:
        normalized: dict[str, str | int | float | bool | None] = {}
        for key, value in credentials.items():
            if isinstance(value, str | int | float | bool) or value is None:
                normalized[key] = value
            else:
                normalized[key] = str(value)
        return normalized
