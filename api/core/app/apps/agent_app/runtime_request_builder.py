"""Build dify-agent run requests for one Agent App conversation turn.

Mirrors the workflow ``WorkflowAgentRuntimeRequestBuilder`` but for the Agent
App surface: the user prompt is the chat message (no workflow-node job / no
previous-node context), multi-turn continuity flows through the
conversation-keyed ``session_snapshot`` plus the history layer, and Agent Soul
knowledge config is mapped into the same fixed ``dify.knowledge_base`` layer
used by workflow runs.
"""

from __future__ import annotations

import base64
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

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
from core.app.entities.app_invoke_entities import DifyRunContext
from core.workflow.nodes.agent_v2.plugin_tools_builder import (
    WorkflowAgentPluginToolsBuilder,
    WorkflowAgentPluginToolsBuildError,
)
from core.workflow.nodes.agent_v2.runtime_request_builder import (
    append_runtime_warnings,
    build_ask_human_layer_config,
    build_drive_aware_soul_mention_resolver,
    build_drive_layer_config,
    build_knowledge_layer_config,
    build_shell_layer_config,
)
from graphon.file import File, FileType, FileUploadConfig, file_manager
from models.agent_config_entities import AgentSoulConfig
from models.provider_ids import ModelProviderID
from services.agent.prompt_mentions import build_soul_mention_resolver, expand_prompt_mentions


class AgentAppRuntimeRequestBuildError(ValueError):
    """Raised when Agent App state cannot be mapped to a valid run request."""

    def __init__(self, error_code: str, message: str) -> None:
        self.error_code = error_code
        super().__init__(message)


class CredentialsProvider(Protocol):
    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]: ...


@dataclass(frozen=True, slots=True)
class AgentAppRuntimeBuildContext:
    dify_context: DifyRunContext
    agent_id: str
    agent_config_snapshot_id: str
    agent_soul: AgentSoulConfig
    conversation_id: str
    user_query: str
    idempotency_key: str
    files: tuple[File, ...] = ()
    file_upload_config: FileUploadConfig | None = None
    session_snapshot: CompositorSessionSnapshot | None = None
    # ENG-638: set when resuming a chat turn after a submitted ask_human form.
    deferred_tool_results: DeferredToolResultsPayload | None = None


@dataclass(frozen=True, slots=True)
class AgentAppRuntimeRequest:
    request: CreateRunRequest
    redacted_request: dict[str, Any]
    metadata: dict[str, Any]


class AgentAppRuntimeRequestBuilder:
    """Build dify-agent run requests from Agent App conversation state."""

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

    def build(self, context: AgentAppRuntimeBuildContext) -> AgentAppRuntimeRequest:
        agent_soul = context.agent_soul
        if agent_soul.model is None:
            raise AgentAppRuntimeRequestBuildError(
                "agent_model_not_configured",
                "Agent App requires the Agent Soul model to be configured.",
            )

        metadata = self._build_metadata(context)
        credentials = self._credentials_provider.fetch(agent_soul.model.model_provider, agent_soul.model.model)
        try:
            tools_layer = self._plugin_tools_builder.build(
                tenant_id=context.dify_context.tenant_id,
                app_id=context.dify_context.app_id,
                user_id=context.dify_context.user_id,
                tools=agent_soul.tools,
                invoke_from=context.dify_context.invoke_from,
            )
        except WorkflowAgentPluginToolsBuildError as error:
            raise AgentAppRuntimeRequestBuildError(error.error_code, str(error)) from error
        if tools_layer is not None or agent_soul.tools.cli_tools:
            metadata["agent_tools"] = {
                "dify_tool_count": len(tools_layer.tools) if tools_layer is not None else 0,
                "dify_tool_names": [tool.name or tool.tool_name for tool in tools_layer.tools]
                if tools_layer is not None
                else [],
                "cli_tool_count": len(agent_soul.tools.cli_tools),
            }

        drive_config = None
        soul_prompt_resolver = build_soul_mention_resolver(agent_soul)
        if dify_config.AGENT_DRIVE_MANIFEST_ENABLED:
            drive_config, drive_warnings = build_drive_layer_config(
                agent_soul,
                tenant_id=context.dify_context.tenant_id,
                agent_id=context.agent_id,
            )
            append_runtime_warnings(metadata, drive_warnings)
            soul_prompt_resolver = build_drive_aware_soul_mention_resolver(
                agent_soul,
                tenant_id=context.dify_context.tenant_id,
                agent_id=context.agent_id,
            )
        knowledge_config = build_knowledge_layer_config(agent_soul)

        request = self._request_builder.build_for_agent_app(
            AgentBackendAgentAppRunInput(
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
                execution_context=DifyExecutionContextLayerConfig(
                    tenant_id=context.dify_context.tenant_id,
                    user_id=context.dify_context.user_id,
                    app_id=context.dify_context.app_id,
                    conversation_id=context.conversation_id,
                    agent_id=context.agent_id,
                    agent_config_version_id=context.agent_config_snapshot_id,
                    # Agent Files §1.3: real Dify access context + agent run mode.
                    user_from=cast(DifyExecutionContextUserFrom, context.dify_context.user_from.value),
                    invoke_from=cast(DifyExecutionContextInvokeFrom, context.dify_context.invoke_from.value),
                    agent_mode="agent_app",
                ),
                # ENG-616: expand slash-menu mention tokens to canonical names so
                # no frontend-internal {{#…#}} marker ever reaches the model.
                agent_soul_prompt=expand_prompt_mentions(agent_soul.prompt.system_prompt, soul_prompt_resolver).strip()
                or None,
                user_prompt=context.user_query,
                user_files=self._build_user_files(context.files, context.file_upload_config),
                tools=tools_layer,
                knowledge=knowledge_config,
                drive_config=drive_config,
                ask_human_config=build_ask_human_layer_config(agent_soul),
                include_shell=dify_config.AGENT_SHELL_ENABLED,
                shell_config=build_shell_layer_config(agent_soul),
                session_snapshot=context.session_snapshot,
                deferred_tool_results=context.deferred_tool_results,
                idempotency_key=context.idempotency_key,
                metadata=metadata,
            )
        )
        redacted = cast(dict[str, Any], redact_for_agent_backend_log(request))
        return AgentAppRuntimeRequest(request=request, redacted_request=redacted, metadata=metadata)

    @staticmethod
    def _build_metadata(context: AgentAppRuntimeBuildContext) -> dict[str, Any]:
        return {
            "tenant_id": context.dify_context.tenant_id,
            "app_id": context.dify_context.app_id,
            "conversation_id": context.conversation_id,
            "agent_id": context.agent_id,
            "agent_config_snapshot_id": context.agent_config_snapshot_id,
        }

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
    def _normalize_credentials(credentials: Mapping[str, Any]) -> dict[str, str | int | float | bool | None]:
        normalized: dict[str, str | int | float | bool | None] = {}
        for key, value in credentials.items():
            if isinstance(value, str | int | float | bool) or value is None:
                normalized[key] = value
            else:
                normalized[key] = str(value)
        return normalized

    @staticmethod
    def _build_user_files(
        files: tuple[File, ...],
        file_upload_config: FileUploadConfig | None,
    ) -> list[DifyUserPromptFileConfig]:
        detail = _image_detail(file_upload_config)
        return [_build_user_file(file, detail=detail) for file in files]


def _build_user_file(file: File, *, detail: Literal["low", "high"] | None) -> DifyUserPromptFileConfig:
    file_type = file.type.value if isinstance(file.type, FileType) else str(file.type)
    if file_type not in {"image", "document", "audio", "video"}:
        raise AgentAppRuntimeRequestBuildError(
            "agent_user_file_unsupported",
            f"Agent App does not support file type '{file_type}' in user prompt.",
        )
    mime_type = file.mime_type or "application/octet-stream"
    return DifyUserPromptFileConfig(
        filename=file.filename or "file",
        mime_type=mime_type,
        format=_file_format(file),
        type=cast(Any, file_type),
        base64_data=base64.b64encode(file_manager.download(file)).decode(),
        detail=detail if file_type == "image" else None,
    )


def _file_format(file: File) -> str:
    extension = (file.extension or "").lstrip(".").lower()
    if extension:
        return extension
    mime_type = file.mime_type or ""
    if "/" in mime_type:
        return mime_type.rsplit("/", 1)[-1].lower()
    return "bin"


def _image_detail(file_upload_config: FileUploadConfig | None) -> Literal["low", "high"] | None:
    image_config = file_upload_config.image_config if file_upload_config is not None else None
    detail = image_config.detail if image_config is not None else None
    if detail is None:
        return None
    detail_value = getattr(detail, "value", detail)
    return cast(Literal["low", "high"], detail_value) if detail_value in {"low", "high"} else None


__all__ = [
    "AgentAppRuntimeBuildContext",
    "AgentAppRuntimeRequest",
    "AgentAppRuntimeRequestBuildError",
    "AgentAppRuntimeRequestBuilder",
]
