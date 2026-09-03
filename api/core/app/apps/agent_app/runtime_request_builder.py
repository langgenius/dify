"""Build dify-agent run requests for one Agent App conversation turn.

Mirrors the workflow ``WorkflowAgentRuntimeRequestBuilder`` but for the Agent
App surface: the user prompt is the chat message (no workflow-node job / no
previous-node context), multi-turn continuity flows through the
conversation-keyed ``session_snapshot`` plus the history layer, and Agent Soul
knowledge config is mapped into the same fixed ``dify.knowledge_base`` layer
used by workflow runs.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal, cast

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.layers.execution_context import (
    DifyExecutionContextInvokeFrom,
    DifyExecutionContextLayerConfig,
    DifyExecutionContextUserFrom,
)
from dify_agent.layers.user_prompt import DifyUserPromptFileConfig
from dify_agent.protocol import CreateRunRequest, DeferredToolResultsPayload

from clients.agent_backend import (
    AgentBackendAgentAppRunInput,
    AgentBackendModelConfig,
    AgentBackendRunRequestBuilder,
    redact_for_agent_backend_log,
)
from configs import dify_config
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom
from core.app.llm.model_access import resolve_model_context_window, resolve_model_supports_vision
from core.plugin.provider_identity import normalize_plugin_daemon_provider_identity
from core.workflow.file_reference import build_file_reference, is_canonical_file_reference
from core.workflow.nodes.agent_v2.dify_tools_builder import (
    WorkflowAgentDifyToolLayersBuilder,
    WorkflowAgentDifyToolsBuilder,
    WorkflowAgentDifyToolsBuildError,
    WorkflowAgentToolLayers,
)
from core.workflow.nodes.agent_v2.runtime_request_builder import (
    append_runtime_warnings,
    build_ask_human_layer_config,
    build_config_aware_soul_mention_resolver,
    build_config_layer_config,
    build_knowledge_layer_config,
    build_shell_layer_config,
    load_runtime_agent_skill_configs,
)
from graphon.file import File, FileTransferMethod, FileType, file_manager
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
from models.agent_config_entities import AgentSoulConfig, AgentSoulToolsConfig
from models.provider_ids import ModelProviderID
from services.agent.prompt_mentions import expand_prompt_mentions

from .errors import AgentSessionSnapshotIncompatibleError


class AgentAppRuntimeRequestBuildError(ValueError):
    """Raised when Agent App state cannot be mapped to a valid run request."""

    def __init__(self, error_code: str, message: str) -> None:
        self.error_code = error_code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class AgentAppRuntimeBuildContext:
    dify_context: DifyRunContext
    agent_id: str
    agent_config_snapshot_id: str
    agent_soul: AgentSoulConfig
    conversation_id: str
    user_query: str
    idempotency_key: str
    binding_id: str
    backend_binding_ref: str
    files: tuple[File, ...] = ()
    image_detail_config: ImagePromptMessageContent.DETAIL | None = None
    agent_config_version_kind: Literal["snapshot", "draft", "build_draft"] = "snapshot"
    session_snapshot: CompositorSessionSnapshot | None = None
    # ENG-638: set when resuming a chat turn after a submitted ask_human form.
    deferred_tool_results: DeferredToolResultsPayload | None = None


@dataclass(frozen=True, slots=True)
class AgentAppRuntimeRequest:
    request: CreateRunRequest
    redacted_request: dict[str, Any]
    metadata: dict[str, Any]
    binding_id: str


class AgentAppRuntimeRequestBuilder:
    """Build dify-agent run requests from Agent App conversation state."""

    def __init__(
        self,
        *,
        request_builder: AgentBackendRunRequestBuilder | None = None,
        dify_tools_builder: WorkflowAgentDifyToolLayersBuilder | None = None,
    ) -> None:
        self._request_builder = request_builder or AgentBackendRunRequestBuilder()
        self._dify_tools_builder = dify_tools_builder or WorkflowAgentDifyToolsBuilder()

    def build(self, context: AgentAppRuntimeBuildContext) -> AgentAppRuntimeRequest:
        agent_soul = context.agent_soul
        if agent_soul.model is None:
            raise AgentAppRuntimeRequestBuildError(
                "agent_model_not_configured",
                "Agent App requires the Agent Soul model to be configured.",
            )

        metadata = self._build_metadata(context)
        try:
            tool_layers = self._build_tool_layers(
                tenant_id=context.dify_context.tenant_id,
                app_id=context.dify_context.app_id,
                user_id=context.dify_context.user_id,
                tools=agent_soul.tools,
                invoke_from=context.dify_context.invoke_from,
            )
        except WorkflowAgentDifyToolsBuildError as error:
            raise AgentAppRuntimeRequestBuildError(error.error_code, str(error)) from error
        if tool_layers.plugin_tools is not None or tool_layers.core_tools is not None or agent_soul.tools.cli_tools:
            metadata["agent_tools"] = {
                "dify_tool_count": len(tool_layers.exposed_tool_names()),
                "dify_tool_names": tool_layers.exposed_tool_names(),
                "cli_tool_count": len(agent_soul.tools.cli_tools),
            }

        runtime_config_skills = load_runtime_agent_skill_configs(
            tenant_id=context.dify_context.tenant_id,
            agent_id=context.agent_id,
        )
        config_layer_config, config_warnings = build_config_layer_config(
            agent_soul,
            agent_id=context.agent_id,
            config_version_id=context.agent_config_snapshot_id,
            config_version_kind=context.agent_config_version_kind,
            runtime_config_skills=runtime_config_skills,
        )
        append_runtime_warnings(metadata, config_warnings)
        soul_prompt_resolver = build_config_aware_soul_mention_resolver(
            agent_soul,
            runtime_config_skills=runtime_config_skills,
        )
        knowledge_config = build_knowledge_layer_config(agent_soul)
        context_window_tokens = resolve_model_context_window(
            run_context=context.dify_context,
            provider_name=agent_soul.model.model_provider,
            model_name=agent_soul.model.model,
        )
        model_plugin_id, model_provider = normalize_plugin_daemon_provider_identity(
            ModelProviderID(agent_soul.model.model_provider),
            agent_soul.model.plugin_id,
        )
        user_prompt, user_files = self._build_user_prompt(
            text=context.user_query,
            files=context.files,
            run_context=context.dify_context,
            provider_name=agent_soul.model.model_provider,
            model_name=agent_soul.model.model,
            image_detail_config=context.image_detail_config,
        )

        request = self._request_builder.build_for_agent_app(
            AgentBackendAgentAppRunInput(
                model=AgentBackendModelConfig(
                    plugin_id=model_plugin_id,
                    model_provider=model_provider,
                    model=agent_soul.model.model,
                    model_settings=agent_soul.model.model_settings.model_dump(mode="json", exclude_none=True),
                    context_window_tokens=context_window_tokens,
                ),
                execution_context=DifyExecutionContextLayerConfig(
                    tenant_id=context.dify_context.tenant_id,
                    user_id=context.dify_context.user_id,
                    app_id=context.dify_context.app_id,
                    conversation_id=context.conversation_id,
                    agent_id=context.agent_id,
                    agent_config_version_id=context.agent_config_snapshot_id,
                    agent_config_version_kind=context.agent_config_version_kind,
                    # Agent Files §1.3: real Dify access context + agent run mode.
                    user_from=cast(DifyExecutionContextUserFrom, context.dify_context.user_from.value),
                    invoke_from=cast(DifyExecutionContextInvokeFrom, context.dify_context.invoke_from.value),
                    agent_mode="agent_app",
                ),
                backend_binding_ref=context.backend_binding_ref,
                # ENG-616: expand slash-menu mention tokens to canonical names so
                # no frontend-internal {{#…#}} marker ever reaches the model.
                agent_soul_prompt=expand_prompt_mentions(agent_soul.prompt.system_prompt, soul_prompt_resolver).strip()
                or None,
                agent_config_version_kind=context.agent_config_version_kind,
                user_prompt=user_prompt,
                user_files=user_files,
                tools=tool_layers.plugin_tools,
                core_tools=tool_layers.core_tools,
                knowledge=knowledge_config,
                config_layer_config=config_layer_config,
                ask_human_config=build_ask_human_layer_config(agent_soul),
                include_shell=dify_config.AGENT_SHELL_ENABLED,
                shell_config=build_shell_layer_config(agent_soul),
                session_snapshot=context.session_snapshot,
                deferred_tool_results=context.deferred_tool_results,
                idempotency_key=context.idempotency_key,
                metadata=metadata,
            )
        )
        self._validate_session_snapshot_layers(request)
        redacted = cast(dict[str, Any], redact_for_agent_backend_log(request))
        return AgentAppRuntimeRequest(
            request=request,
            redacted_request=redacted,
            metadata=metadata,
            binding_id=context.binding_id,
        )

    @staticmethod
    def _build_user_prompt(
        *,
        text: str,
        files: tuple[File, ...],
        run_context: DifyRunContext,
        provider_name: str,
        model_name: str,
        image_detail_config: ImagePromptMessageContent.DETAIL | None,
    ) -> tuple[str, list[DifyUserPromptFileConfig]]:
        images = [file for file in files if file.type == FileType.IMAGE]
        supports_vision = bool(images) and resolve_model_supports_vision(
            run_context=run_context,
            provider_name=provider_name,
            model_name=model_name,
        )
        direct_images = images if supports_vision else []
        direct_image_ids = {id(file) for file in direct_images}
        fallback_files = [file for file in files if id(file) not in direct_image_ids]
        return _append_file_locators(text, fallback_files), [
            _build_user_file(file, image_detail_config=image_detail_config) for file in direct_images
        ]

    @staticmethod
    def _validate_session_snapshot_layers(request: CreateRunRequest) -> None:
        """Reject stale snapshots before they reach the Agent backend.

        Draft rows are updated in place, so their IDs cannot prove that a
        retained snapshot still belongs to the current composition. Agenton
        requires the ordered layer names to match exactly; enforce the same
        invariant at the API boundary and return a product-level error.
        """

        snapshot = request.session_snapshot
        if snapshot is None:
            return
        snapshot_layer_names = tuple(layer.name for layer in snapshot.layers)
        composition_layer_names = tuple(layer.name for layer in request.composition.layers)
        if snapshot_layer_names != composition_layer_names:
            raise AgentSessionSnapshotIncompatibleError()

    def _build_tool_layers(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str | None,
        tools: AgentSoulToolsConfig,
        invoke_from: InvokeFrom,
    ) -> WorkflowAgentToolLayers:
        # Production Agent App runs intentionally keep existing plugin configs
        # on the direct `dify.plugin.tools` route. This builder emits plugin
        # tools directly and non-plugin Dify tools through `dify.core.tools`.
        return self._dify_tools_builder.build_layers(
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
            tools=tools,
            invoke_from=invoke_from,
        )

    @staticmethod
    def _build_metadata(context: AgentAppRuntimeBuildContext) -> dict[str, Any]:
        return {
            "tenant_id": context.dify_context.tenant_id,
            "app_id": context.dify_context.app_id,
            "conversation_id": context.conversation_id,
            "agent_id": context.agent_id,
            "agent_config_snapshot_id": context.agent_config_snapshot_id,
        }


def _build_user_file(
    file: File,
    *,
    image_detail_config: ImagePromptMessageContent.DETAIL | None,
) -> DifyUserPromptFileConfig:
    content = file_manager.to_prompt_message_content(file, image_detail_config=image_detail_config)
    if not isinstance(content, ImagePromptMessageContent):
        raise AgentAppRuntimeRequestBuildError(
            "agent_user_file_unsupported",
            f"Agent App cannot send file '{file.filename or 'image'}' as vision content.",
        )
    detail = content.detail.value
    return DifyUserPromptFileConfig(
        filename=content.filename or file.filename or f"image.{content.format}",
        mime_type=content.mime_type,
        format=content.format,
        url=content.url or None,
        base64_data=content.base64_data or None,
        detail=detail if detail in {"low", "high"} else None,
    )


def _append_file_locators(text: str, files: list[File]) -> str:
    locators = [_file_locator(file) for file in files]
    if not locators:
        return text
    payload = json.dumps(locators, ensure_ascii=False, separators=(",", ":"))
    return (
        f"{text}\n"
        "User provided files: use dify-agent file download with the listed transfer_method and reference/url "
        "to get the files and investigate them\n"
        f"{payload}"
    )


def _file_locator(file: File) -> dict[str, str]:
    if file.transfer_method == FileTransferMethod.REMOTE_URL:
        if file.remote_url is None:
            raise AgentAppRuntimeRequestBuildError("agent_user_file_invalid", "Remote user file is missing its URL.")
        return {"transfer_method": FileTransferMethod.REMOTE_URL.value, "url": file.remote_url}
    if file.reference is None:
        raise AgentAppRuntimeRequestBuildError("agent_user_file_invalid", "User file is missing its reference.")
    reference = file.reference
    if not reference.startswith("dify-file-ref:"):
        reference = build_file_reference(record_id=reference)
    elif not is_canonical_file_reference(reference):
        raise AgentAppRuntimeRequestBuildError("agent_user_file_invalid", "User file reference is invalid.")
    return {"transfer_method": file.transfer_method.value, "reference": reference}


__all__ = [
    "AgentAppRuntimeBuildContext",
    "AgentAppRuntimeRequest",
    "AgentAppRuntimeRequestBuildError",
    "AgentAppRuntimeRequestBuilder",
]
