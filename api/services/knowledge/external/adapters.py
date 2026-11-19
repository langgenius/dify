"""External knowledge HTTP and access-policy adapters."""

import json
from collections.abc import Mapping
from typing import Any

import httpx
from pydantic import JsonValue, TypeAdapter, ValidationError

from core.helper import ssrf_proxy
from machinery.context import RequestContext
from services.enterprise import rbac_service
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError
from services.knowledge.entities.external import (
    ExternalKnowledgeApiSetting,
    ExternalKnowledgeRetrievalRequest,
    ExternalRetrievalCandidate,
    validate_external_knowledge_api_settings,
)
from services.knowledge.entities.resource_scope import DatasetRef
from services.rbac.contracts import RBACResourceType

_METADATA_ADAPTER = TypeAdapter(dict[str, JsonValue])


def _retrieval_url(endpoint: str) -> str:
    """Append the retrieval path to a nonempty provider endpoint.

    Preconditions: ``endpoint`` is the validated or persisted external-provider base URL. Postconditions: the returned
    URL preserves the base and contains exactly one slash before ``retrieval``; ``endpoint`` is not mutated.
    """
    return f"{endpoint.rstrip('/')}/retrieval"


def sync_external_dataset_creator_access(context: RequestContext, ref: DatasetRef) -> None:
    rbac_service.try_sync_creator_access_policy_member_bindings(
        context.active_workspace_id,
        context.account_id,
        RBACResourceType.DATASET,
        ref.dataset_id,
    )


class ExternalKnowledgeGateway:
    """Validate and call an external provider without owning persistence."""

    def check_settings(self, settings: Mapping[str, Any]) -> None:
        self.check_endpoint_and_api_key(settings)

    def retrieve(self, request: ExternalKnowledgeRetrievalRequest) -> list[ExternalRetrievalCandidate]:
        prepared = self.build_external_knowledge_retrieval_request(request)
        return self.execute_external_knowledge_retrieval(prepared)

    @staticmethod
    def check_endpoint_and_api_key(settings: Mapping[str, Any]) -> None:
        """Probe a configured endpoint and API key without changing the settings.

        Preconditions: settings must contain a valid HTTP(S) endpoint and a nonempty API key. Postconditions: the
        provider is probed at its normalized retrieval URL; connection, routing, and authorization failures raise a
        secret-free ``ValueError`` while provider argument errors remain acceptable.
        """
        validate_external_knowledge_api_settings(settings)
        endpoint = _retrieval_url(settings["endpoint"])
        payload = {
            "knowledge_id": "",
            "query": "",
            "retrieval_setting": {"top_k": 1, "score_threshold": 0.0},
        }
        try:
            response = ssrf_proxy.post(
                endpoint,
                headers={"Authorization": f"Bearer {settings['api_key']}", "Content-Type": "application/json"},
                data=json.dumps(payload),
            )
        except Exception as error:
            raise ValueError(f"failed to connect to the endpoint: {endpoint}") from error
        if response.status_code == 502:
            raise ValueError(f"Bad Gateway: failed to connect to the endpoint: {endpoint}")
        if response.status_code == 404:
            raise ValueError(f"Not Found: failed to connect to the endpoint: {endpoint}")
        if response.status_code in {401, 403}:
            raise ValueError("Forbidden: Authorization failed with the provided api_key")

    @staticmethod
    def send_retrieval_request(request: ExternalKnowledgeApiSetting) -> httpx.Response:
        return ssrf_proxy.post(
            request.url,
            headers=request.headers,
            data=json.dumps(request.params),
            follow_redirects=True,
        )

    @staticmethod
    def build_external_knowledge_retrieval_request(
        request: ExternalKnowledgeRetrievalRequest,
    ) -> ExternalKnowledgeApiSetting:
        """Build one provider request from tenant-owned configuration.

        Preconditions: ``request.endpoint`` is a nonempty persisted provider base URL. Postconditions: the returned
        request has one slash before ``retrieval`` and carries only the supplied query, binding, and retrieval options.
        """
        headers = {"Content-Type": "application/json"}
        if request.api_key:
            headers["Authorization"] = f"Bearer {request.api_key}"
        parameters = request.retrieval_model
        threshold = parameters.score_threshold if parameters.score_threshold_enabled else 0.0
        return ExternalKnowledgeApiSetting(
            url=_retrieval_url(request.endpoint),
            headers=headers,
            params={
                "retrieval_setting": {"top_k": parameters.top_k, "score_threshold": threshold},
                "query": request.query,
                "knowledge_id": request.knowledge_id,
                "metadata_condition": request.metadata_filters.model_dump() if request.metadata_filters else None,
            },
        )

    @staticmethod
    def execute_external_knowledge_retrieval(
        request: ExternalKnowledgeApiSetting,
    ) -> list[ExternalRetrievalCandidate]:
        try:
            response = ExternalKnowledgeGateway.send_retrieval_request(request)
        except Exception as error:
            raise ExternalKnowledgeRetrievalError(str(error)) from error
        if response.status_code != 200:
            raise ExternalKnowledgeRetrievalError(response.text)
        try:
            payload = response.json()
        except Exception as error:
            raise ExternalKnowledgeRetrievalError("invalid external knowledge response") from error
        if not isinstance(payload, dict) or not isinstance(payload.get("records"), list):
            raise ExternalKnowledgeRetrievalError("invalid external knowledge response: records must be a list")

        candidates: list[ExternalRetrievalCandidate] = []
        for index, record in enumerate(payload["records"]):
            if not isinstance(record, dict):
                raise ExternalKnowledgeRetrievalError(
                    f"invalid external knowledge response: records[{index}] must be an object"
                )
            content = record.get("content", "")
            score = record.get("score", 0.0)
            title = record.get("title")
            if not isinstance(content, str):
                raise ExternalKnowledgeRetrievalError(
                    f"invalid external knowledge response: records[{index}].content must be a string"
                )
            if isinstance(score, bool) or not isinstance(score, int | float):
                raise ExternalKnowledgeRetrievalError(
                    f"invalid external knowledge response: records[{index}].score must be a number"
                )
            if title is not None and not isinstance(title, str):
                raise ExternalKnowledgeRetrievalError(
                    f"invalid external knowledge response: records[{index}].title must be a string"
                )
            try:
                metadata = _METADATA_ADAPTER.validate_python(record.get("metadata", {}), strict=True)
            except ValidationError as error:
                raise ExternalKnowledgeRetrievalError(
                    f"invalid external knowledge response: records[{index}].metadata must contain JSON values"
                ) from error
            candidates.append(
                ExternalRetrievalCandidate(
                    content=content,
                    score=float(score),
                    title=title,
                    metadata=metadata,
                )
            )
        return candidates
