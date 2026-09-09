"""Shared KnowledgeFS layer mapping for Agent App and Workflow AgentV2."""

from dify_agent.layers.knowledge_fs import DifyKnowledgeFsLayerConfig
from dify_agent.protocol.knowledge_fs import KnowledgeFsBinding, KnowledgeFsError

from configs import dify_config
from core.app.entities.app_invoke_entities import DifyRunContext
from core.app.llm.model_access import DifyModelFactory
from graphon.model_runtime.entities.model_entities import ModelFeature
from models.agent_config_entities import AgentSoulConfig


def build_knowledge_fs_layer_config(
    agent_soul: AgentSoulConfig, *, run_context: DifyRunContext
) -> DifyKnowledgeFsLayerConfig | None:
    if agent_soul.knowledge.sets:
        raise KnowledgeFsError(
            "KNOWLEDGE_REBIND_REQUIRED",
            "Replace Classic Knowledge Base bindings with Agent Knowledge Base bindings before running.",
        )
    if not agent_soul.knowledge.spaces:
        return None
    if any(space.is_missing for space in agent_soul.knowledge.spaces):
        raise KnowledgeFsError("KNOWLEDGE_REBIND_REQUIRED", "Reselect imported or unavailable Agent Knowledge Bases.")
    if not dify_config.AGENT_SHELL_ENABLED:
        raise KnowledgeFsError(
            "KNOWLEDGE_SHELL_UNAVAILABLE", "Agent Knowledge Base CLI requires the Agent sandbox shell.", 503
        )
    if not agent_soul.model:
        raise KnowledgeFsError(
            "KNOWLEDGE_MODEL_REQUIRED", "Select an Agent model before using an Agent Knowledge Base."
        )
    schema = (
        DifyModelFactory(run_context=run_context)
        .init_model_instance(
            agent_soul.model.model_provider,
            agent_soul.model.model,
        )
        .get_model_schema()
    )
    return DifyKnowledgeFsLayerConfig(
        spaces=[
            KnowledgeFsBinding.model_validate(space.model_dump(exclude={"is_missing"}))
            for space in agent_soul.knowledge.spaces
        ],
        agent_supports_vision=ModelFeature.VISION in (schema.features or []),
    )
