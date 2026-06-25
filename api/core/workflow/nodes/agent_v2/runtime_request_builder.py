from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, assert_never, cast

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.layers.ask_human import DifyAskHumanLayerConfig
from dify_agent.layers.drive import (
    DifyDriveLayerConfig,
    DifyDriveSkillConfig,
)
from dify_agent.layers.execution_context import (
    DifyExecutionContextInvokeFrom,
    DifyExecutionContextLayerConfig,
    DifyExecutionContextUserFrom,
)
from dify_agent.layers.knowledge import (
    DifyKnowledgeBaseLayerConfig,
    DifyKnowledgeDatasetConfig,
    DifyKnowledgeMetadataFilteringConfig,
    DifyKnowledgeModelConfig,
    DifyKnowledgeQueryConfig,
    DifyKnowledgeRerankingModelConfig,
    DifyKnowledgeRetrievalConfig,
    DifyKnowledgeSetConfig,
)
from dify_agent.layers.shell import (
    DifyShellCliToolConfig,
    DifyShellEnvVarConfig,
    DifyShellLayerConfig,
    DifyShellSandboxConfig,
    DifyShellSecretRefConfig,
)
from dify_agent.protocol import CreateRunRequest, DeferredToolResultsPayload
from pydantic import BaseModel

from clients.agent_backend import (
    AgentBackendModelConfig,
    AgentBackendOutputConfig,
    AgentBackendRunRequestBuilder,
    AgentBackendWorkflowNodeRunInput,
    redact_for_agent_backend_log,
)
from configs import dify_config
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.file import FileTransferMethod
from graphon.variables.segments import Segment
from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
from models.agent_config_entities import (
    AgentKnowledgeMetadataFilteringConfig,
    AgentKnowledgeModelConfig,
    AgentKnowledgeRetrievalConfig,
    AgentSoulConfig,
    DeclaredArrayItem,
    DeclaredOutputChildConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
    WorkflowPreviousNodeOutputRef,
)
from models.agent_config_entities import (
    effective_declared_outputs as _effective_declared_outputs,
)
from models.provider_ids import ModelProviderID
from services.agent.prompt_mentions import (
    MentionKind,
    build_node_job_mention_resolver,
    build_soul_mention_resolver,
    expand_prompt_mentions,
    parse_prompt_mentions,
)
from services.agent.soul_files_service import AgentSoulFilesService
from services.agent_drive_service import decode_drive_mention_ref

from .output_failure_orchestrator import retry_idempotency_key
from .plugin_tools_builder import WorkflowAgentPluginToolsBuilder, WorkflowAgentPluginToolsBuildError
from .runtime_feature_manifest import build_runtime_feature_manifest

_DENIED_PERMISSION_STATUSES = frozenset({"unauthorized", "denied", "forbidden", "invalid", "unavailable"})
_DANGEROUS_FLAG_KEYS = ("dangerous", "dangerous_command", "requires_confirmation")
_DANGEROUS_ACK_KEYS = (
    "dangerous_acknowledged",
    "dangerous_accepted",
    "risk_accepted",
    "approved",
)


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
    # ENG-638: set when resuming after a submitted ask_human HITL form; threads
    # the human's answer back into the second Agent run keyed by tool_call_id.
    deferred_tool_results: DeferredToolResultsPayload | None = None


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
        # ENG-616: expand slash-menu mention tokens into model-readable names.
        # node_output mentions expand to their reference name only — the value
        # stays in the Workflow context block (user_prompt) below.
        workflow_job_prompt = (
            expand_prompt_mentions(node_job.workflow_prompt, build_node_job_mention_resolver(node_job)).strip()
            or "Run this workflow Agent Node for the current run."
        )
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
        if tools_layer is not None or agent_soul.tools.cli_tools:
            metadata["agent_tools"] = {
                "dify_tool_count": len(tools_layer.tools) if tools_layer is not None else 0,
                "dify_tool_names": [tool.name or tool.tool_name for tool in tools_layer.tools]
                if tools_layer is not None
                else [],
                "cli_tool_count": len(agent_soul.tools.cli_tools),
            }

        drive_config: DifyDriveLayerConfig | None = None
        soul_prompt_resolver = build_soul_mention_resolver(agent_soul)
        if dify_config.AGENT_DRIVE_MANIFEST_ENABLED:
            drive_config, drive_warnings = build_drive_layer_config(
                agent_soul,
                tenant_id=context.dify_context.tenant_id,
                agent_id=context.agent.id,
            )
            append_runtime_warnings(metadata, drive_warnings)
            soul_prompt_resolver = build_drive_aware_soul_mention_resolver(
                agent_soul,
                tenant_id=context.dify_context.tenant_id,
                agent_id=context.agent.id,
            )
        soul_prompt = expand_prompt_mentions(agent_soul.prompt.system_prompt, soul_prompt_resolver).strip()
        knowledge_config = build_knowledge_layer_config(agent_soul)

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
                    model_settings=agent_soul.model.model_settings.model_dump(mode="json", exclude_none=True),
                ),
                # The execution-context layer is now the only public protocol
                # carrier for Dify tenant/user/run identifiers. ``user_id`` and
                # ``user_from`` must be forwarded here because downstream plugin-
                # daemon provider/tool clients and knowledge-base layers read
                # caller identity from this layer rather than from any parallel
                # top-level request field.
                execution_context=DifyExecutionContextLayerConfig(
                    tenant_id=context.dify_context.tenant_id,
                    user_id=context.dify_context.user_id,
                    user_from=cast(DifyExecutionContextUserFrom, context.dify_context.user_from.value),
                    app_id=context.dify_context.app_id,
                    workflow_id=context.workflow_id,
                    workflow_run_id=context.workflow_run_id,
                    node_id=context.node_id,
                    node_execution_id=context.node_execution_id,
                    conversation_id=get_system_text(context.variable_pool, SystemVariableKey.CONVERSATION_ID),
                    agent_id=context.agent.id,
                    agent_config_version_id=context.snapshot.id,
                    agent_mode=self._agent_backend_agent_mode(context.dify_context.invoke_from),
                    invoke_from=cast(DifyExecutionContextInvokeFrom, context.dify_context.invoke_from.value),
                ),
                agent_soul_prompt=soul_prompt or None,
                workflow_node_job_prompt=workflow_job_prompt,
                user_prompt=user_prompt,
                output=self._build_output_config(node_job.declared_outputs),
                tools=tools_layer,
                knowledge=knowledge_config,
                drive_config=drive_config,
                ask_human_config=build_ask_human_layer_config(agent_soul),
                include_shell=dify_config.AGENT_SHELL_ENABLED,
                shell_config=build_shell_layer_config(agent_soul),
                session_snapshot=context.session_snapshot,
                deferred_tool_results=context.deferred_tool_results,
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
    def _agent_backend_agent_mode(invoke_from: InvokeFrom) -> Literal["workflow_run", "single_step"]:
        if invoke_from in {InvokeFrom.DEBUGGER, InvokeFrom.VALIDATION}:
            return "single_step"
        return "workflow_run"

    @staticmethod
    def _plugin_daemon_plugin_id(*, plugin_id: str, model_provider: str) -> str:
        """Return the transport plugin id expected by plugin-daemon headers."""
        if plugin_id.count("/") == 1:
            return plugin_id.split(":", 1)[0].split("@", 1)[0]
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
        refs: Sequence[WorkflowPreviousNodeOutputRef],
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
    def _selector_from_ref(ref: WorkflowPreviousNodeOutputRef) -> list[str] | None:
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
        schema = WorkflowAgentRuntimeRequestBuilder._schema_for_type(
            output.type,
            array_item=output.array_item,
            children=output.children,
        )
        if output.description:
            schema["description"] = output.description
        return schema

    @staticmethod
    def _schema_for_type(
        output_type: DeclaredOutputType,
        *,
        array_item: DeclaredArrayItem | None = None,
        children: Sequence[DeclaredOutputChildConfig] | None = None,
    ) -> dict[str, Any]:
        match output_type:
            case DeclaredOutputType.STRING:
                return {"type": "string"}
            case DeclaredOutputType.NUMBER:
                return {"type": "number"}
            case DeclaredOutputType.BOOLEAN:
                return {"type": "boolean"}
            case DeclaredOutputType.OBJECT:
                object_schema: dict[str, Any] = {"type": "object"}
                WorkflowAgentRuntimeRequestBuilder._apply_child_properties(object_schema, children or [])
                return object_schema
            case DeclaredOutputType.ARRAY:
                # Stage 4 §4.2: items shape mirrors the declared array_item.
                # Validator guarantees array_item is set when type is array.
                item_type = array_item.type if array_item else DeclaredOutputType.OBJECT
                array_schema: dict[str, Any] = {
                    "type": "array",
                    "items": WorkflowAgentRuntimeRequestBuilder._schema_for_type(
                        item_type,
                        children=array_item.children if array_item else None,
                    ),
                }
                if array_item is not None and array_item.description:
                    array_schema["items"]["description"] = array_item.description
                return array_schema
            case DeclaredOutputType.FILE:
                return {
                    "oneOf": [
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "transfer_method": {"const": FileTransferMethod.LOCAL_FILE.value},
                                "reference": {"type": "string"},
                            },
                            "required": ["transfer_method", "reference"],
                        },
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "transfer_method": {"const": FileTransferMethod.TOOL_FILE.value},
                                "reference": {"type": "string"},
                            },
                            "required": ["transfer_method", "reference"],
                        },
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "transfer_method": {"const": FileTransferMethod.DATASOURCE_FILE.value},
                                "reference": {"type": "string"},
                            },
                            "required": ["transfer_method", "reference"],
                        },
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "transfer_method": {"const": FileTransferMethod.REMOTE_URL.value},
                                "url": {"type": "string"},
                            },
                            "required": ["transfer_method", "url"],
                        },
                    ],
                }
        assert_never(output_type)

    @staticmethod
    def _apply_child_properties(schema: dict[str, Any], children: Sequence[DeclaredOutputChildConfig]) -> None:
        if not children:
            return
        properties: dict[str, Any] = {}
        required: list[str] = []
        for child in children:
            child_schema = WorkflowAgentRuntimeRequestBuilder._schema_for_type(
                child.type,
                array_item=child.array_item,
                children=child.children,
            )
            if child.description:
                child_schema["description"] = child.description
            properties[child.name] = child_schema
            if child.required:
                required.append(child.name)
        schema["properties"] = properties
        if required:
            schema["required"] = required

    @staticmethod
    def _normalize_credentials(credentials: Mapping[str, Any]) -> dict[str, str | int | float | bool | None]:
        normalized: dict[str, str | int | float | bool | None] = {}
        for key, value in credentials.items():
            if isinstance(value, str | int | float | bool) or value is None:
                normalized[key] = value
            else:
                normalized[key] = str(value)
        return normalized


def build_shell_layer_config(agent_soul: AgentSoulConfig) -> DifyShellLayerConfig:
    """Map Agent Soul shell-adjacent fields into the Agent backend shell config."""
    sandbox_config = _plain_mapping(agent_soul.sandbox.config)
    return DifyShellLayerConfig(
        cli_tools=[
            tool
            for tool in (_shell_cli_tool(item) for item in agent_soul.tools.cli_tools if _cli_tool_enabled(item))
            if tool is not None
        ],
        env=[env for env in (_shell_env_var(item) for item in agent_soul.env.variables) if env is not None],
        secret_refs=[
            secret for secret in (_shell_secret_ref(item) for item in agent_soul.env.secret_refs) if secret is not None
        ],
        sandbox=DifyShellSandboxConfig(
            provider=agent_soul.sandbox.provider,
            config=sandbox_config,
        )
        if agent_soul.sandbox.provider or sandbox_config
        else None,
    )


def build_knowledge_layer_config(agent_soul: AgentSoulConfig) -> DifyKnowledgeBaseLayerConfig | None:
    """Map Agent Soul knowledge sets into one Dify knowledge-base layer.

    Agent Soul DTO validation owns malformed set rejection. Runtime mapping is
    intentionally lossless: every configured set is forwarded with its query
    policy, dataset refs, retrieval controls, and metadata-filtering controls.
    ``score_threshold=None`` means disabled threshold filtering and maps to the
    inner retrieval request's ``0.0`` default through the Agent backend DTO.
    """
    if not agent_soul.knowledge.sets:
        return None

    return DifyKnowledgeBaseLayerConfig(
        sets=[
            DifyKnowledgeSetConfig(
                id=knowledge_set.id,
                name=knowledge_set.name,
                description=knowledge_set.description,
                datasets=[
                    DifyKnowledgeDatasetConfig(
                        id=dataset.id or "",
                        name=dataset.name,
                        description=dataset.description,
                    )
                    for dataset in knowledge_set.datasets
                ],
                query=DifyKnowledgeQueryConfig(
                    mode=cast(Literal["user_query", "generated_query"], knowledge_set.query.mode.value),
                    value=knowledge_set.query.value,
                ),
                retrieval=_knowledge_retrieval_config(knowledge_set.retrieval),
                metadata_filtering=_knowledge_metadata_filtering_config(knowledge_set.metadata_filtering),
            )
            for knowledge_set in agent_soul.knowledge.sets
        ],
    )


def _knowledge_retrieval_config(retrieval: AgentKnowledgeRetrievalConfig) -> DifyKnowledgeRetrievalConfig:
    return DifyKnowledgeRetrievalConfig(
        mode=retrieval.mode,
        top_k=retrieval.top_k,
        score_threshold=retrieval.score_threshold or 0.0,
        reranking_mode=retrieval.reranking_mode,
        reranking_enable=retrieval.reranking_enable,
        reranking_model=DifyKnowledgeRerankingModelConfig(
            provider=retrieval.reranking_model.provider,
            model=retrieval.reranking_model.model,
        )
        if retrieval.reranking_model is not None
        else None,
        weights=cast(dict[str, Any], retrieval.weights.model_dump(mode="json", exclude_none=True))
        if retrieval.weights is not None
        else None,
        model=_knowledge_model_config(retrieval.model),
    )


def _knowledge_metadata_filtering_config(
    metadata_filtering: AgentKnowledgeMetadataFilteringConfig,
) -> DifyKnowledgeMetadataFilteringConfig:
    return DifyKnowledgeMetadataFilteringConfig(
        mode=metadata_filtering.mode,
        model_config=_knowledge_model_config(metadata_filtering.metadata_model_config),
        conditions=cast(Any, metadata_filtering.conditions.model_dump(mode="json"))
        if metadata_filtering.conditions is not None
        else None,
    )


def _knowledge_model_config(model: AgentKnowledgeModelConfig | None) -> DifyKnowledgeModelConfig | None:
    if model is None:
        return None
    return DifyKnowledgeModelConfig(
        provider=model.provider,
        name=model.name,
        mode=model.mode,
        completion_params=model.completion_params,
    )


def build_ask_human_layer_config(agent_soul: AgentSoulConfig) -> DifyAskHumanLayerConfig | None:
    """Enable the dify.ask_human deferred tool when the soul configures human involvement.

    HITL is opt-in: only when at least one human contact is configured does the
    model get the ``ask_human`` tool (recipients for the resulting form come from
    those contacts, ENG-635). Returns ``None`` to leave the tool off entirely.
    The tool/field guardrails use the layer defaults; ``human.tools`` semantics are
    out of scope this round.
    """
    if not agent_soul.human.contacts:
        return None
    return DifyAskHumanLayerConfig()


def append_runtime_warnings(metadata: dict[str, Any], warnings: list[dict[str, str]]) -> None:
    """Merge build-time warnings into the metadata runtime-support manifest."""
    if not warnings:
        return
    manifest = metadata.setdefault("runtime_support", {})
    if isinstance(manifest, dict):
        existing = manifest.setdefault("unsupported_runtime_warnings", [])
        if isinstance(existing, list):
            existing.extend(warnings)


def build_drive_aware_soul_mention_resolver(
    agent_soul: AgentSoulConfig,
    *,
    tenant_id: str,
    agent_id: str,
):
    """Resolve skill/file mentions against versioned Agent Soul refs and everything else via Agent Soul."""

    base_resolver = build_soul_mention_resolver(agent_soul)
    skill_names_by_key = {
        skill.skill_md_key: skill.name for skill in agent_soul.files.skills if skill.skill_md_key and skill.name
    }
    file_names_by_key = {
        file_ref.drive_key: file_ref.name or file_ref.drive_key.rsplit("/", 1)[-1]
        for file_ref in agent_soul.files.files
        if file_ref.drive_key
    }

    def _resolve(mention: object) -> str | None:
        if not hasattr(mention, "kind") or not hasattr(mention, "ref_id"):
            return None
        kind = cast(MentionKind, mention.kind)
        ref_id = cast(str, mention.ref_id)
        label = cast(str | None, getattr(mention, "label", None))
        if kind == MentionKind.SKILL:
            decoded_key = decode_drive_mention_ref(ref_id)
            return skill_names_by_key.get(decoded_key) or label or decoded_key
        if kind == MentionKind.FILE:
            decoded_key = decode_drive_mention_ref(ref_id)
            return file_names_by_key.get(decoded_key) or label or decoded_key
        return base_resolver(cast(Any, mention))

    return _resolve


def build_drive_layer_config(
    agent_soul: AgentSoulConfig,
    *,
    tenant_id: str,
    agent_id: str | None,
) -> tuple[DifyDriveLayerConfig | None, list[dict[str, str]]]:
    """Derive drive runtime catalog + prompt-mentioned eager-pull keys from Agent Soul refs."""

    mentioned_drive_refs = [
        decode_drive_mention_ref(mention.ref_id)
        for mention in parse_prompt_mentions(agent_soul.prompt.system_prompt)
        if mention.kind in {MentionKind.SKILL, MentionKind.FILE}
    ]
    ordered_mentions = list(dict.fromkeys(ref for ref in mentioned_drive_refs if ref))
    if not agent_id:
        if not ordered_mentions:
            return None, []
        return None, [
            {
                "section": "agent_soul.prompt.system_prompt",
                "code": "drive_ref_dangling",
                "message": "drive mentions are configured but the run has no bound agent to address a drive by.",
            }
        ]

    skills_catalog = [
        {
            "path": skill.path or AgentSoulFilesService.skill_path_from_key(skill.skill_md_key),
            "name": skill.name or skill.path or skill.skill_md_key,
            "description": skill.description or "",
            "skill_md_key": skill.skill_md_key,
            "archive_key": skill.full_archive_key,
        }
        for skill in agent_soul.files.skills
        if skill.skill_md_key
    ]
    soul_file_keys = {
        key
        for key in AgentSoulFilesService.allowed_drive_keys(agent_soul)
        if key not in {skill["skill_md_key"] for skill in skills_catalog}
    }
    skill_keys = {skill["skill_md_key"] for skill in skills_catalog}
    warnings: list[dict[str, str]] = []
    mentioned_skill_keys: list[str] = []
    mentioned_file_keys: list[str] = []
    for drive_key in ordered_mentions:
        if drive_key in skill_keys:
            mentioned_skill_keys.append(drive_key)
            continue
        if drive_key in soul_file_keys:
            mentioned_file_keys.append(drive_key)
            continue
        warnings.append(
            {
                "section": "agent_soul.prompt.system_prompt",
                "code": "mention_target_missing",
                "message": f"drive mention '{drive_key}' has no matching drive entry.",
            }
        )

    skills = [
        DifyDriveSkillConfig(
            path=skill["path"],
            name=skill["name"],
            description=skill["description"],
            skill_md_key=skill["skill_md_key"],
            archive_key=skill["archive_key"],
        )
        for skill in skills_catalog
    ]

    return (
        DifyDriveLayerConfig(
            drive_ref=f"agent-{agent_id}",
            skills=skills,
            mentioned_skill_keys=mentioned_skill_keys,
            mentioned_file_keys=mentioned_file_keys,
        ),
        warnings,
    )


def _cli_tool_enabled(item: object) -> bool:
    """A CLI tool is bootstrapped unless explicitly disabled (default is enabled)."""
    data = _plain_mapping(item)
    if data.get("enabled") is False:
        return False
    if data.get("pre_authorized") is False or _permission_denied(data):
        return False
    if _dangerous_without_acknowledgement(data):
        return False
    return True


def _shell_cli_tool(item: object) -> DifyShellCliToolConfig | None:
    data = _plain_mapping(item)
    commands: list[str] = []
    raw_commands = data.get("install_commands")
    if isinstance(raw_commands, list):
        commands.extend(str(command) for command in raw_commands if str(command).strip())
    # ``command`` is the typed AgentCliToolConfig field; the rest are accepted aliases.
    for key in ("install_command", "install", "setup_command", "command"):
        raw_command = data.get(key)
        if isinstance(raw_command, str) and raw_command.strip():
            commands.append(raw_command)
    name = data.get("name") or data.get("tool_name") or data.get("label")
    if not commands and not isinstance(name, str):
        return None
    tool_env = data.get("env") if isinstance(data.get("env"), Mapping) else {}
    env = [
        env_var
        for env_var in (_shell_env_var(item) for item in _env_entries(tool_env, "variables"))
        if env_var is not None
    ]
    secret_refs = [
        secret_ref
        for secret_ref in (_shell_secret_ref(item) for item in _env_entries(tool_env, "secret_refs"))
        if secret_ref is not None
    ]
    return DifyShellCliToolConfig(
        name=name if isinstance(name, str) else None,
        install_commands=commands,
        env=env,
        secret_refs=secret_refs,
    )


def _env_entries(env: object, key: str) -> list[object]:
    if not isinstance(env, Mapping):
        return []
    entries = env.get(key)
    if not isinstance(entries, list):
        return []
    return entries


def _shell_env_var(item: object) -> DifyShellEnvVarConfig | None:
    data = _plain_mapping(item)
    name = _name_from_mapping(data)
    if name is None:
        return None
    value = data.get("value", data.get("default", ""))
    if not isinstance(value, str):
        value = str(value)
    return DifyShellEnvVarConfig(name=name, value=value)


def _shell_secret_ref(item: object) -> DifyShellSecretRefConfig | None:
    data = _plain_mapping(item)
    name = _name_from_mapping(data)
    if name is None:
        return None
    ref = (
        data.get("ref")
        or data.get("value")
        or data.get("id")
        or data.get("credential_id")
        or data.get("provider_credential_id")
    )
    return DifyShellSecretRefConfig(name=name, ref=str(ref) if ref is not None else None)


def _plain_mapping(item: object) -> dict[str, Any]:
    if isinstance(item, BaseModel):
        return item.model_dump(mode="python", exclude_none=True, exclude_defaults=True)
    if isinstance(item, Mapping):
        return dict(item)
    return {}


def _name_from_mapping(item: Mapping[str, Any]) -> str | None:
    for key in ("name", "key", "env_name", "variable"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _permission_denied(data: Mapping[str, Any]) -> bool:
    permission = data.get("permission")
    if isinstance(permission, Mapping):
        allowed = permission.get("allowed")
        if allowed is False:
            return True
        status = permission.get("status") or permission.get("state")
        if isinstance(status, str) and status in _DENIED_PERMISSION_STATUSES:
            return True

    for key in ("authorization_status", "permission_status", "status"):
        status = data.get(key)
        if isinstance(status, str) and status in _DENIED_PERMISSION_STATUSES:
            return True
    return False


def _dangerous_without_acknowledgement(data: Mapping[str, Any]) -> bool:
    dangerous = any(data.get(key) is True for key in _DANGEROUS_FLAG_KEYS)
    risk_level = data.get("risk_level")
    if isinstance(risk_level, str) and risk_level == "dangerous":
        dangerous = True
    if not dangerous:
        return False
    return not any(data.get(key) is True for key in _DANGEROUS_ACK_KEYS)
