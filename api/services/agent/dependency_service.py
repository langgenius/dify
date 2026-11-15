"""Plugin dependency discovery shared by portable Agent formats."""

from models.agent_config_entities import (
    AgentKnowledgeMetadataFilteringConfig,
    AgentKnowledgeRetrievalConfig,
    AgentSoulConfig,
)
from services.plugin.dependencies_analysis import DependenciesAnalysisService


def _extract_knowledge_retrieval_dependencies(retrieval: AgentKnowledgeRetrievalConfig) -> list[str]:
    if retrieval.mode == "single":
        if retrieval.model is None:
            return []
        return [DependenciesAnalysisService.analyze_model_provider_dependency(retrieval.model.provider)]

    if not retrieval.reranking_enable:
        return []

    if retrieval.reranking_mode == "reranking_model":
        if retrieval.reranking_model is None:
            return []
        return [DependenciesAnalysisService.analyze_model_provider_dependency(retrieval.reranking_model.provider)]

    if retrieval.reranking_mode == "weighted_score" and retrieval.weights is not None:
        vector_setting = retrieval.weights.vector_setting
        embedding_provider = vector_setting.get("embedding_provider_name") if vector_setting is not None else None
        if embedding_provider:
            return [DependenciesAnalysisService.analyze_model_provider_dependency(embedding_provider)]

    return []


def _extract_metadata_filtering_dependencies(
    metadata_filtering: AgentKnowledgeMetadataFilteringConfig,
) -> list[str]:
    if metadata_filtering.mode != "automatic" or metadata_filtering.metadata_model_config is None:
        return []
    return [
        DependenciesAnalysisService.analyze_model_provider_dependency(metadata_filtering.metadata_model_config.provider)
    ]


def extract_agent_soul_dependencies(soul: AgentSoulConfig) -> list[str]:
    dependencies: list[str] = []
    if soul.model is not None:
        dependencies.append(DependenciesAnalysisService.analyze_model_provider_dependency(soul.model.model_provider))
    suggested_questions = soul.app_features.suggested_questions_after_answer
    if suggested_questions is not None and suggested_questions.model is not None:
        dependencies.append(
            DependenciesAnalysisService.analyze_model_provider_dependency(suggested_questions.model.provider)
        )
    for tool in soul.tools.dify_tools:
        provider_id = tool.provider_id or (
            f"{tool.plugin_id}/{tool.provider}" if tool.plugin_id and tool.provider else None
        )
        if provider_id:
            dependencies.append(DependenciesAnalysisService.analyze_tool_dependency(provider_id))
    for knowledge_set in soul.knowledge.sets:
        dependencies.extend(_extract_knowledge_retrieval_dependencies(knowledge_set.retrieval))
        dependencies.extend(_extract_metadata_filtering_dependencies(knowledge_set.metadata_filtering))
    return dependencies


__all__ = ["extract_agent_soul_dependencies"]
