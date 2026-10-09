"""Load external knowledge request configuration without performing HTTP calls."""

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.entities import MetadataFilteringCondition
from models.dataset import ExternalKnowledgeApis, ExternalKnowledgeBindings
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalKnowledgeApiSetting
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError


def prepare_external_retrieval(
    tenant_id: str,
    dataset_id: str,
    query: str,
    external_retrieval_parameters: dict[str, Any],
    metadata_condition: MetadataFilteringCondition | None = None,
    *,
    session: Session,
) -> ExternalKnowledgeApiSetting:
    """Resolve owned configuration into a request that outlives the read session."""
    external_knowledge_binding = session.scalar(
        select(ExternalKnowledgeBindings)
        .where(ExternalKnowledgeBindings.dataset_id == dataset_id, ExternalKnowledgeBindings.tenant_id == tenant_id)
        .limit(1)
    )
    if not external_knowledge_binding:
        raise ExternalKnowledgeRetrievalError("external knowledge binding not found")

    external_knowledge_api = session.scalar(
        select(ExternalKnowledgeApis)
        .where(
            ExternalKnowledgeApis.id == external_knowledge_binding.external_knowledge_api_id,
            ExternalKnowledgeApis.tenant_id == tenant_id,
        )
        .limit(1)
    )
    if external_knowledge_api is None or external_knowledge_api.settings is None:
        raise ExternalKnowledgeRetrievalError("external api template not found")

    settings = json.loads(external_knowledge_api.settings)
    headers = {"Content-Type": "application/json"}
    if settings.get("api_key"):
        headers["Authorization"] = f"Bearer {settings.get('api_key')}"
    score_threshold_enabled = external_retrieval_parameters.get("score_threshold_enabled") or False
    score_threshold = external_retrieval_parameters.get("score_threshold", 0.0) if score_threshold_enabled else 0.0
    request_params = {
        "retrieval_setting": {
            "top_k": external_retrieval_parameters.get("top_k"),
            "score_threshold": score_threshold,
        },
        "query": query,
        "knowledge_id": external_knowledge_binding.external_knowledge_id,
        "metadata_condition": metadata_condition.model_dump() if metadata_condition else None,
    }

    return ExternalKnowledgeApiSetting(
        url=f"{settings.get('endpoint')}/retrieval",
        request_method="post",
        headers=headers,
        params=request_params,
    )
