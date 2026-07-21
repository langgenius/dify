"""Safe Agenton compositor construction for API-submitted configs.

Only explicitly allowed provider type ids are constructible here. The default
provider set contains prompt layers, the optional pydantic-ai history layer, the
state-free Dify structured output layer, the optional Dify ask-human layer, the
Dify execution-context and runtime-resource layers, the stateful Dify shell
layer, and the Dify plugin/knowledge business-layer family:

- ``dify.config`` for Agent Soul-backed config assets + eager pull,
- ``dify.execution_context`` for shared tenant/user/run daemon context,
- ``dify.home`` for an immutable config-version Home Snapshot binding,
- ``dify.workspace`` for the runtime-session Workspace identity,
- ``dify.sandbox`` for the deployment-selected physical resource lifecycle,
- ``dify.shell`` for command/file capabilities from the active Sandbox lease,
- ``dify.plugin.llm`` for plugin-backed model selection,
- ``dify.plugin.tools`` for prepared plugin tool exposure, and
- ``dify.core.tools`` for API-routed Dify tool exposure, and
- ``dify.knowledge_base`` for inner-API-backed knowledge search tools.

Public DTOs provide Dify context plus plugin/model/tool data, while server-only
plugin daemon settings and Dify API inner settings are injected through provider
factories. The deployment-selected runtime backend profile is injected only
into the resource-owning Sandbox layer. Shell receives Agent Stub settings and
consumes the active Sandbox lease's data plane. The resulting ``Compositor``
remains Agenton state-only at the snapshot boundary: live resources such as
HTTP clients are injected by runtime-owned providers, may be held on active
layer instances inside ``resource_context()``, and never enter session
snapshots.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, cast

from pydantic_ai.messages import UserContent

from agenton.compositor import Compositor, CompositorConfig, LayerProvider, LayerProviderInput
from agenton.layers.types import AllPromptTypes, AllToolTypes, AllUserPromptTypes, PydanticAIPrompt, PydanticAITool
from agenton_collections.layers.pydantic_ai import PydanticAIHistoryLayer
from agenton_collections.layers.plain.basic import PromptLayer
from agenton_collections.transformers.pydantic_ai import PYDANTIC_AI_TRANSFORMERS
from dify_agent.agent_stub.shell_env import ShellAgentStubTokenFactory
from dify_agent.layers.ask_human.layer import DifyAskHumanLayer
from dify_agent.layers.config.layer import DifyConfigLayer
from dify_agent.layers.dify_core_tools.configs import DifyCoreToolsLayerConfig
from dify_agent.layers.dify_core_tools.layer import DifyCoreToolsLayer
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.layers.dify_plugin.configs import DifyPluginToolsLayerConfig
from dify_agent.layers.dify_plugin.tools_layer import DifyPluginToolsLayer
from dify_agent.layers.drive.layer import DifyDriveLayer
from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.home.layer import DifyHomeLayer
from dify_agent.layers.knowledge.configs import DifyKnowledgeBaseLayerConfig
from dify_agent.layers.knowledge.layer import DifyKnowledgeBaseLayer
from dify_agent.layers.output.output_layer import DifyOutputLayer
from dify_agent.layers.sandbox.configs import DifySandboxLayerConfig
from dify_agent.layers.sandbox.layer import DifySandboxLayer
from dify_agent.layers.shell.configs import DifyShellLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer
from dify_agent.layers.workspace.layer import DifyWorkspaceLayer
from dify_agent.runtime_backend import RuntimeBackendProfile

type DifyAgentLayerProvider = LayerProvider[Any]


def create_default_layer_providers(
    *,
    plugin_daemon_url: str = "http://localhost:5002",
    plugin_daemon_api_key: str = "",
    inner_api_url: str = "http://localhost:5001",
    inner_api_key: str = "",
    runtime_backend_profile: RuntimeBackendProfile | None = None,
    shell_redact_patterns: list[str] | None = None,
    agent_stub_api_base_url: str | None = None,
    agent_stub_token_factory: ShellAgentStubTokenFactory | None = None,
) -> tuple[DifyAgentLayerProvider, ...]:
    """Return the server provider set of safe config-constructible layers."""
    providers: list[DifyAgentLayerProvider] = [
        LayerProvider.from_layer_type(PromptLayer),
        LayerProvider.from_layer_type(PydanticAIHistoryLayer),
        LayerProvider.from_layer_type(DifyOutputLayer),
        LayerProvider.from_layer_type(DifyAskHumanLayer),
        LayerProvider.from_layer_type(DifyConfigLayer),
        LayerProvider.from_layer_type(DifyDriveLayer),
        LayerProvider.from_factory(
            layer_type=DifyExecutionContextLayer,
            create=lambda config: DifyExecutionContextLayer.from_config_with_settings(
                DifyExecutionContextLayerConfig.model_validate(config),
                daemon_url=plugin_daemon_url,
                daemon_api_key=plugin_daemon_api_key,
            ),
        ),
        LayerProvider.from_factory(
            layer_type=DifyShellLayer,
            create=lambda config: DifyShellLayer.from_config_with_settings(
                DifyShellLayerConfig.model_validate(config),
                shell_redact_patterns=shell_redact_patterns or [],
                agent_stub_api_base_url=agent_stub_api_base_url,
                agent_stub_token_factory=agent_stub_token_factory,
            ),
        ),
        LayerProvider.from_layer_type(DifyPluginLLMLayer),
        LayerProvider.from_factory(
            layer_type=DifyPluginToolsLayer,
            create=lambda config: DifyPluginToolsLayer.from_config_with_settings(
                DifyPluginToolsLayerConfig.model_validate(config),
                inner_api_url=inner_api_url,
                inner_api_key=inner_api_key,
            ),
        ),
        LayerProvider.from_factory(
            layer_type=DifyCoreToolsLayer,
            create=lambda config: DifyCoreToolsLayer.from_config_with_settings(
                DifyCoreToolsLayerConfig.model_validate(config),
                inner_api_url=inner_api_url,
                inner_api_key=inner_api_key,
            ),
        ),
        LayerProvider.from_factory(
            layer_type=DifyKnowledgeBaseLayer,
            create=lambda config: DifyKnowledgeBaseLayer.from_config_with_settings(
                DifyKnowledgeBaseLayerConfig.model_validate(config),
                inner_api_url=inner_api_url,
                inner_api_key=inner_api_key,
            ),
        ),
    ]
    if runtime_backend_profile is not None:
        providers.extend(
            [
                LayerProvider.from_layer_type(DifyHomeLayer),
                LayerProvider.from_layer_type(DifyWorkspaceLayer),
                LayerProvider.from_factory(
                    layer_type=DifySandboxLayer,
                    create=lambda config: DifySandboxLayer.from_config_with_driver(
                        DifySandboxLayerConfig.model_validate(config),
                        driver=runtime_backend_profile.sandboxes,
                    ),
                ),
            ]
        )
    return tuple(providers)


def build_pydantic_ai_compositor(
    config: CompositorConfig,
    *,
    providers: Sequence[LayerProviderInput],
    node_providers: Mapping[str, LayerProviderInput] | None = None,
) -> Compositor[
    PydanticAIPrompt[object],
    PydanticAITool[object],
    AllPromptTypes,
    AllToolTypes,
    UserContent,
    AllUserPromptTypes,
]:
    """Build a Pydantic AI-ready compositor from a validated graph config.

    Prompt, user prompt, and tool conversion is delegated to Agenton's shared
    pydantic-ai transformer preset so Dify Agent does not duplicate conversion
    logic for plain and pydantic-ai layer families. Callers must pass the already
    selected provider set explicitly so provider defaulting stays at outer runtime
    boundaries rather than being duplicated here.
    """
    return cast(
        Compositor[
            PydanticAIPrompt[object],
            PydanticAITool[object],
            AllPromptTypes,
            AllToolTypes,
            UserContent,
            AllUserPromptTypes,
        ],
        Compositor.from_config(
            config,
            providers=providers,
            node_providers=node_providers,
            **PYDANTIC_AI_TRANSFORMERS,  # pyright: ignore[reportArgumentType]
        ),
    )


__all__ = ["DifyAgentLayerProvider", "build_pydantic_ai_compositor", "create_default_layer_providers"]
