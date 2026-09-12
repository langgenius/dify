"""Resolve external memory through the same tenant-scoped tool owner as agents."""

import logging

from dify_agent.layers.memory import DifyMemoryLayerConfig

from core.app.entities.app_invoke_entities import DifyRunContext
from core.workflow.nodes.agent_v2.dify_tools_builder import WorkflowAgentDifyToolLayersBuilder
from models.agent_config_entities import AgentSoulConfig, AgentSoulToolsConfig

logger = logging.getLogger(__name__)


def build_memory_layer_config(
    soul: AgentSoulConfig, context: DifyRunContext, builder: WorkflowAgentDifyToolLayersBuilder
) -> DifyMemoryLayerConfig | None:
    external = soul.memory.external
    if external is None:
        return None
    try:
        layers = builder.build_layers(
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            user_id=context.user_id,
            tools=AgentSoulToolsConfig(dify_tools=[external.prepare, external.observe]),
            invoke_from=context.invoke_from,
        )
    except Exception:
        # Memory is an optional context source. Do not log credential-bearing exceptions.
        logger.warning("External memory degraded: provider_configuration_unavailable")
        return None

    if layers.plugin_tools is None or len(layers.plugin_tools.tools) != 2:
        raise ValueError("External memory requires two plugin operations")
    prepare, observe = layers.plugin_tools.tools
    return DifyMemoryLayerConfig(
        prepare=prepare,
        observe=observe,
        subject_kind=external.subject_kind,
        subject_id=external.subject_id,
        max_bytes=external.max_bytes,
        capture_max_bytes=external.capture_max_bytes,
        capture=external.capture,
    )


def model_tools_config(soul: AgentSoulConfig) -> AgentSoulToolsConfig:
    external = soul.memory.external
    if external is None:
        return soul.tools
    selected = [external.prepare, external.observe]

    def is_callback(tool):
        return any(
            tool.tool_name == callback.tool_name
            and tool.provider_type == callback.provider_type
            and (
                (tool.provider_id and tool.provider_id == callback.provider_id)
                or (tool.plugin_id and tool.plugin_id == callback.plugin_id and tool.provider == callback.provider)
            )
            for callback in selected
        )

    return soul.tools.model_copy(
        update={"dify_tools": [tool for tool in soul.tools.dify_tools if not is_callback(tool)]}
    )
