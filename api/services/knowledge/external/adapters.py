"""External knowledge HTTP and access-policy adapters."""

import json
from collections.abc import Mapping
from dataclasses import replace
from typing import Any, cast
from urllib.parse import urlparse

import httpx

from core.helper import ssrf_proxy
from graphon.nodes.http_request.exc import InvalidHttpMethodError
from libs.helper import escape_query_for_search
from machinery.context import RequestContext
from services.enterprise import rbac_service
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError
from services.knowledge.entities.external import ExternalKnowledgeApiSetting, ExternalKnowledgeRetrievalRequest
from services.knowledge.entities.resource_scope import DatasetRef
from services.rbac.contracts import RBACResourceType


def sync_external_dataset_creator_access(context: RequestContext, ref: DatasetRef) -> None:
    rbac_service.try_sync_creator_access_policy_member_bindings(
        context.active_workspace_id, context.account_id, RBACResourceType.DATASET, ref.dataset_id
    )


class ExternalKnowledgeGateway:
    def check_settings(self, settings: Mapping[str, Any]) -> None:
        self.check_endpoint_and_api_key(dict(settings))

    def retrieve(self, request: ExternalKnowledgeRetrievalRequest) -> list[dict[str, Any]]:
        """Apply the hit-testing query format before calling the external provider."""
        request = replace(request, query=escape_query_for_search(request.query))
        http_request = self.build_external_knowledge_retrieval_request(request)
        return cast(list[dict[str, Any]], self.execute_external_knowledge_retrieval(http_request))

    @staticmethod
    def check_endpoint_and_api_key(settings: dict[str, Any]):
        if "endpoint" not in settings or not settings["endpoint"]:
            raise ValueError("endpoint is required")
        if "api_key" not in settings or not settings["api_key"]:
            raise ValueError("api_key is required")

        endpoint = f"{settings['endpoint']}/retrieval"
        api_key = settings["api_key"]

        parsed_url = urlparse(endpoint)
        if not all([parsed_url.scheme, parsed_url.netloc]):
            if not endpoint.startswith("http://") and not endpoint.startswith("https://"):
                raise ValueError(f"invalid endpoint: {endpoint} must start with http:// or https://")
            else:
                raise ValueError(f"invalid endpoint: {endpoint}")
        # Send a minimal body shaped like the External Knowledge API retrieval contract so providers
        # that require a JSON payload (e.g. RAGFlow) accept the validation probe instead of rejecting
        # a body-less POST. Mirrors the request built in build_external_knowledge_retrieval_request.
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
        except Exception as e:
            raise ValueError(f"failed to connect to the endpoint: {endpoint}") from e
        if response.status_code == 502:
            raise ValueError(f"Bad Gateway: failed to connect to the endpoint: {endpoint}")
        if response.status_code == 404:
            raise ValueError(f"Not Found: failed to connect to the endpoint: {endpoint}")
        if response.status_code == 403:
            raise ValueError("Forbidden: Authorization failed with the provided api_key")

    @staticmethod
    def process_external_api(settings: ExternalKnowledgeApiSetting, files: dict[str, Any] | None) -> httpx.Response:
        """
        do http request depending on api bundle
        """

        kwargs: dict[str, Any] = {
            "url": settings.url,
            "headers": settings.headers,
            "follow_redirects": True,
        }

        _METHOD_MAP = {
            "get": ssrf_proxy.get,
            "head": ssrf_proxy.head,
            "post": ssrf_proxy.post,
            "put": ssrf_proxy.put,
            "delete": ssrf_proxy.delete,
            "patch": ssrf_proxy.patch,
        }
        method_lc = settings.request_method.lower()
        if method_lc not in _METHOD_MAP:
            raise InvalidHttpMethodError(f"Invalid http method {settings.request_method}")

        response: httpx.Response = _METHOD_MAP[method_lc](data=json.dumps(settings.params), files=files, **kwargs)
        return response

    @staticmethod
    def build_external_knowledge_retrieval_request(
        request: ExternalKnowledgeRetrievalRequest,
    ) -> ExternalKnowledgeApiSetting:
        """Adapt domain retrieval input to the external provider's HTTP contract."""
        headers = {"Content-Type": "application/json"}
        if request.api_key:
            headers["Authorization"] = f"Bearer {request.api_key}"
        parameters = request.retrieval_model
        threshold = parameters.get("score_threshold", 0.0) if parameters.get("score_threshold_enabled") else 0.0
        return ExternalKnowledgeApiSetting(
            url=f"{request.endpoint}/retrieval",
            request_method="post",
            headers=headers,
            params={
                "retrieval_setting": {"top_k": parameters.get("top_k"), "score_threshold": threshold},
                "query": request.query,
                "knowledge_id": request.knowledge_id,
                "metadata_condition": request.metadata_filters,
            },
        )

    @staticmethod
    def execute_external_knowledge_retrieval(request: ExternalKnowledgeApiSetting) -> list[Any]:
        """Execute and validate a prepared request without holding a database session."""
        try:
            response = ExternalKnowledgeGateway.process_external_api(
                request,
                None,
            )
        except ExternalKnowledgeRetrievalError:
            raise
        except Exception as exc:
            raise ExternalKnowledgeRetrievalError(str(exc)) from exc

        if response.status_code == 200:
            try:
                response_payload = response.json()
            except Exception as exc:
                raise ExternalKnowledgeRetrievalError("invalid external knowledge response") from exc

            if not isinstance(response_payload, dict):
                raise ExternalKnowledgeRetrievalError("invalid external knowledge response")

            records = response_payload.get("records", [])
            if not isinstance(records, list):
                raise ExternalKnowledgeRetrievalError("invalid external knowledge response")

            return cast(list[Any], records)
        else:
            raise ExternalKnowledgeRetrievalError(response.text)
