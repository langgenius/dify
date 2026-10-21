"""External knowledge endpoint validation and retrieval I/O."""

import json
from collections.abc import Mapping
from typing import Any, cast
from urllib.parse import urlparse

import httpx
from sqlalchemy.orm import Session

from core.helper import ssrf_proxy
from core.rag.entities import MetadataFilteringCondition
from repositories.knowledge.external_repository import SQLAlchemyExternalKnowledgeRepository
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalKnowledgeApiSetting
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError


def validate_external_knowledge_endpoint(settings: Mapping[str, object]) -> None:
    """Probe a template endpoint before opening its persistence transaction."""

    endpoint_value = settings.get("endpoint")
    if not endpoint_value:
        raise ValueError("endpoint is required")
    api_key = settings.get("api_key")
    if not api_key:
        raise ValueError("api_key is required")

    endpoint = f"{endpoint_value}/retrieval"
    parsed_url = urlparse(endpoint)
    if not all([parsed_url.scheme, parsed_url.netloc]):
        if not endpoint.startswith(("http://", "https://")):
            raise ValueError(f"invalid endpoint: {endpoint} must start with http:// or https://")
        raise ValueError(f"invalid endpoint: {endpoint}")

    validation_payload = {
        "knowledge_id": "",
        "query": "",
        "retrieval_setting": {"top_k": 1, "score_threshold": 0.0},
    }
    try:
        response = ssrf_proxy.post(
            endpoint,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            data=json.dumps(validation_payload),
        )
    except Exception as error:
        raise ValueError(f"failed to connect to the endpoint: {endpoint}") from error
    if response.status_code == 502:
        raise ValueError(f"Bad Gateway: failed to connect to the endpoint: {endpoint}")
    if response.status_code == 404:
        raise ValueError(f"Not Found: failed to connect to the endpoint: {endpoint}")
    if response.status_code == 403:
        raise ValueError("Forbidden: Authorization failed with the provided api_key")


def _send_external_knowledge_request(settings: ExternalKnowledgeApiSetting) -> httpx.Response:
    return ssrf_proxy.post(
        settings.url,
        headers=settings.headers,
        data=json.dumps(settings.params),
        follow_redirects=True,
    )


def prepare_external_knowledge_retrieval(
    tenant_id: str,
    dataset_id: str,
    query: str,
    external_retrieval_parameters: dict[str, Any],
    metadata_condition: MetadataFilteringCondition | None = None,
    *,
    session: Session,
) -> ExternalKnowledgeApiSetting:
    """Resolve owned configuration into a request that outlives the read session."""

    repository = SQLAlchemyExternalKnowledgeRepository(session)
    binding = repository.get_dataset_binding(tenant_id=tenant_id, dataset_id=dataset_id)
    if binding is None:
        raise ExternalKnowledgeRetrievalError("external knowledge binding not found")
    template = repository.get_template(
        tenant_id=tenant_id,
        template_id=binding.external_knowledge_api_id,
    )
    if template is None or template.settings is None:
        raise ExternalKnowledgeRetrievalError("external api template not found")

    settings = json.loads(template.settings)
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
        "knowledge_id": binding.external_knowledge_id,
        "metadata_condition": metadata_condition.model_dump() if metadata_condition else None,
    }
    return ExternalKnowledgeApiSetting(
        url=f"{settings.get('endpoint')}/retrieval",
        request_method="post",
        headers=headers,
        params=request_params,
    )


def execute_external_knowledge_retrieval(request: ExternalKnowledgeApiSetting) -> list[Any]:
    """Execute and validate a prepared request without holding a database session."""

    try:
        response = _send_external_knowledge_request(request)
    except ExternalKnowledgeRetrievalError:
        raise
    except Exception as error:
        raise ExternalKnowledgeRetrievalError(str(error)) from error
    if response.status_code != 200:
        raise ExternalKnowledgeRetrievalError(response.text)
    try:
        response_payload = response.json()
    except Exception as error:
        raise ExternalKnowledgeRetrievalError("invalid external knowledge response") from error
    if not isinstance(response_payload, dict):
        raise ExternalKnowledgeRetrievalError("invalid external knowledge response")
    records = response_payload.get("records", [])
    if not isinstance(records, list):
        raise ExternalKnowledgeRetrievalError("invalid external knowledge response")
    return cast(list[Any], records)
