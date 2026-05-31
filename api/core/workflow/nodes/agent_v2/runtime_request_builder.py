from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import CreateRunRequest

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
    DeclaredArrayItem,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
)
from models.agent_config_entities import (
    effective_declared_outputs as _effective_declared_outputs,
)
from models.provider_ids import ModelProviderID

from .output_failure_orchestrator import retry_idempotency_key
from .plugin_tools_builder import WorkflowAgentPluginToolsBuilder, WorkflowAgentPluginToolsBuildError
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
    # Stage 4 §7 / D-4: 0 for the first run, then incremented per retry. Drives the
    # idempotency key so the backend treats each retry as a fresh request.
    attempt: int = 0
    session_snapshot: CompositorSessionSnapshot | None = None


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
        plugin_tools_builder: WorkflowAgentPluginToolsBuilder | None = None,
    ) -> None:
        self._credentials_provider = credentials_provider
        self._request_builder = request_builder or AgentBackendRunRequestBuilder()
        self._plugin_tools_builder = plugin_tools_builder or WorkflowAgentPluginToolsBuilder()

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
        try:
            tools_layer = self._plugin_tools_builder.build(
                tenant_id=context.dify_context.tenant_id,
                app_id=context.dify_context.app_id,
                user_id=context.dify_context.user_id,
                tools=agent_soul.tools,
                # Thread the *real* runtime invocation source through to
                # ToolManager so credential quotas, rate limits, and audit
                # trails match the actual call site (DEBUGGER for draft test
                # run, SERVICE_API / WEB_APP for published run).
                invoke_from=context.dify_context.invoke_from,
            )
        except WorkflowAgentPluginToolsBuildError as error:
            raise WorkflowAgentRuntimeRequestBuildError(error.error_code, str(error)) from error
        if tools_layer is not None:
            metadata["agent_tools"] = {
                "dify_tool_count": len(tools_layer.tools),
                "dify_tool_names": [tool.name or tool.tool_name for tool in tools_layer.tools],
                "cli_tool_count": len(agent_soul.tools.cli_tools),
            }

        request = self._request_builder.build_for_workflow_node(
            AgentBackendWorkflowNodeRunInput(
                model=AgentBackendModelConfig(
                    plugin_id=self._plugin_daemon_plugin_id(
                        plugin_id=agent_soul.model.plugin_id,
                        model_provider=agent_soul.model.model_provider,
                    ),
                    model_provider=self._plugin_daemon_provider_name(agent_soul.model.model_provider),
                    model=agent_soul.model.model,
                    credentials=self._normalize_credentials(credentials),
                    model_settings=agent_soul.model.model_settings,
                ),
                # The execution-context layer is now the only public protocol
                # carrier for Dify tenant/user/run identifiers. ``user_id`` must
                # be forwarded here because downstream plugin-daemon provider and
                # tool clients read it from this layer rather than from any
                # parallel top-level request field.
                execution_context=DifyExecutionContextLayerConfig(
                    tenant_id=context.dify_context.tenant_id,
                    user_id=context.dify_context.user_id,
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
                tools=tools_layer,
                session_snapshot=context.session_snapshot,
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
    def _plugin_daemon_plugin_id(*, plugin_id: str, model_provider: str) -> str:
        """Return the transport plugin id expected by plugin-daemon headers."""
        if plugin_id.count("/") == 1:
            return plugin_id
        if plugin_id:
            return ModelProviderID(plugin_id).plugin_id
        return ModelProviderID(model_provider).plugin_id

    @staticmethod
    def _plugin_daemon_provider_name(model_provider: str) -> str:
        """Return the provider name expected by plugin-daemon dispatch payloads."""
        return ModelProviderID(model_provider).provider_name

    @staticmethod
    def _idempotency_key(context: WorkflowAgentRuntimeBuildContext) -> str:
        # Stage 4 §7 / D-4: retries get distinct keys (``...:retry-{attempt}``) so
        # the Agent backend's protocol-level dedup can't replay a previous run.
        return retry_idempotency_key(
            workflow_run_id=context.workflow_run_id,
            node_execution_id=context.node_execution_id,
            attempt=context.attempt,
        )

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
        """Build the structured-output layer config sent to Agent backend.

        Stage 4 §4.1 (D-3): when the user hasn't declared any outputs, inject the
        PRD-mandated defaults (text / files / json) at runtime so the backend
        always receives a stable schema and the downstream Inspector + nodes
        have consistent output names. The defaults are NOT persisted.
        """
        effective_outputs = WorkflowAgentRuntimeRequestBuilder.effective_declared_outputs(declared_outputs)
        properties: dict[str, Any] = {}
        required: list[str] = []
        for output in effective_outputs:
            properties[output.name] = WorkflowAgentRuntimeRequestBuilder._schema_for_declared_output(output)
            if output.required:
                required.append(output.name)
        schema: dict[str, Any] = {"type": "object", "properties": properties}
        if required:
            schema["required"] = required
        return AgentBackendOutputConfig(json_schema=schema)

    @staticmethod
    def effective_declared_outputs(
        declared_outputs: Sequence[DeclaredOutputConfig],
    ) -> Sequence[DeclaredOutputConfig]:
        """Alias for :func:`models.agent_config_entities.effective_declared_outputs`.

        Kept as a static method on the builder so existing call sites
        (``agent_node._run``, tests) don't need to change their import.
        """
        return _effective_declared_outputs(list(declared_outputs))

    @staticmethod
    def _schema_for_declared_output(output: DeclaredOutputConfig) -> dict[str, Any]:
        schema = WorkflowAgentRuntimeRequestBuilder._schema_for_type(output.type, array_item=output.array_item)
        if output.description:
            schema["description"] = output.description
        return schema

    @staticmethod
    def _schema_for_type(
        output_type: DeclaredOutputType,
        *,
        array_item: DeclaredArrayItem | None = None,
    ) -> dict[str, Any]:
        match output_type:
            case DeclaredOutputType.STRING:
                return {"type": "string"}
            case DeclaredOutputType.NUMBER:
                return {"type": "number"}
            case DeclaredOutputType.BOOLEAN:
                return {"type": "boolean"}
            case DeclaredOutputType.OBJECT:
                return {"type": "object"}
            case DeclaredOutputType.ARRAY:
                # Stage 4 §4.2: items shape mirrors the declared array_item.
                # Validator guarantees array_item is set when type is array.
                item_type = array_item.type if array_item else DeclaredOutputType.OBJECT
                schema: dict[str, Any] = {
                    "type": "array",
                    "items": WorkflowAgentRuntimeRequestBuilder._schema_for_type(item_type),
                }
                if array_item is not None and array_item.description:
                    schema["items"]["description"] = array_item.description
                return schema
            case DeclaredOutputType.FILE:
                return {
                    "type": "object",
                    "properties": {
                        "file_id": {"type": "string"},
                        "filename": {"type": "string"},
                        "mime_type": {"type": "string"},
                        "url": {"type": "string"},
                    },
                }

    @staticmethod
    def _normalize_credentials(credentials: Mapping[str, Any]) -> dict[str, str | int | float | bool | None]:
        normalized: dict[str, str | int | float | bool | None] = {}
        for key, value in credentials.items():
            if isinstance(value, str | int | float | bool) or value is None:
                normalized[key] = value
            else:
                normalized[key] = str(value)
        return normalized
