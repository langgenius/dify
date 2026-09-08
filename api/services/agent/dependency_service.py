"""Plugin dependency discovery shared by portable Agent formats."""

from models.agent_config_entities import AgentSoulConfig
from services.plugin.dependencies_analysis import DependenciesAnalysisService


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
        retrieval = knowledge_set.retrieval
        if retrieval.model is not None:
            dependencies.append(DependenciesAnalysisService.analyze_model_provider_dependency(retrieval.model.provider))
        if retrieval.reranking_model is not None:
            dependencies.append(
                DependenciesAnalysisService.analyze_model_provider_dependency(retrieval.reranking_model.provider)
            )
    return dependencies


__all__ = ["extract_agent_soul_dependencies"]
