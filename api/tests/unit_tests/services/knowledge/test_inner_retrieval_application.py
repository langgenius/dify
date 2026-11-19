from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

import pytest
from pydantic import ValidationError

from graphon.model_runtime.entities.llm_entities import LLMUsage
from machinery.context import RequestContext
from services.errors.knowledge_retrieval import InnerKnowledgeRetrieveAppNotFoundError
from services.knowledge.entities.inner_retrieval import (
    InnerKnowledgeRetrieveRequest,
    InnerKnowledgeRetrieveWeights,
)
from services.knowledge.entities.retrieval import (
    KnowledgeRetrievalRequest,
    KnowledgeRetrievalResult,
    RetrievableDataset,
)
from services.knowledge.retrieval.application import InnerKnowledgeRetrievalService


@dataclass
class ScopeReader:
    events: list[str]
    missing: bool = False
    claims: list[tuple[str, str, list[str]]] = field(default_factory=list)

    def validate_inner_retrieval_scope(self, *, tenant_id: str, app_id: str, dataset_ids: list[str]) -> None:
        self.events.append("scope")
        self.claims.append((tenant_id, app_id, dataset_ids))
        if self.missing:
            raise InnerKnowledgeRetrieveAppNotFoundError("app missing")


@dataclass
class Retrieval:
    events: list[str]
    calls: list[tuple[KnowledgeRetrievalRequest, Mapping[str, object] | None]] = field(default_factory=list)

    def list_datasets(self, *, tenant_id: str, dataset_ids: Sequence[str]) -> list[RetrievableDataset]:
        del tenant_id, dataset_ids
        return []

    def retrieve(
        self,
        request: KnowledgeRetrievalRequest,
        *,
        request_metadata: Mapping[str, object] | None,
    ) -> KnowledgeRetrievalResult:
        self.events.append("retrieval")
        self.calls.append((request, request_metadata))
        return KnowledgeRetrievalResult(sources=[], usage=LLMUsage.empty_usage())


@pytest.mark.parametrize("missing", [False, True])
def test_scope_validation_precedes_runtime(missing: bool) -> None:
    events: list[str] = []
    scopes = ScopeReader(events, missing=missing)
    retrieval = Retrieval(events)
    service = InnerKnowledgeRetrievalService(scope=scopes, retrieval=retrieval)
    context = RequestContext("request-1", "trace-1", "", "")
    request = InnerKnowledgeRetrieveRequest.model_validate(
        {
            "caller": {
                "tenant_id": "tenant-1",
                "app_id": "app-1",
                "user_id": "user-1",
                "user_from": "account",
                "invoke_from": "workflow",
            },
            "dataset_ids": ["dataset-1"],
            "query": "question",
            "retrieval": {"mode": "multiple", "top_k": 4},
        }
    )

    if missing:
        with pytest.raises(InnerKnowledgeRetrieveAppNotFoundError, match="app missing"):
            service.retrieve(context, request)
        assert events == ["scope"]
        assert retrieval.calls == []
    else:
        assert service.retrieve(context, request).results == []
        assert events == ["scope", "retrieval"]
        assert len(retrieval.calls) == 1
        runtime_request, request_metadata = retrieval.calls[0]
        assert runtime_request.tenant_id == "tenant-1"
        assert runtime_request.app_id == "app-1"
        assert runtime_request.dataset_ids == ["dataset-1"]
        assert runtime_request.query == "question"
        assert request_metadata == {
            "app_id": "app-1",
            "request_id": "request-1",
            "trace_id": "trace-1",
        }
    assert scopes.claims == [("tenant-1", "app-1", ["dataset-1"])]


@pytest.mark.parametrize("level", ["weights", "vector_setting", "keyword_setting"])
def test_inner_weight_contract_rejects_unknown_fields(level: str) -> None:
    weights: dict[str, dict[str, object]] = {
        "vector_setting": {
            "vector_weight": 0.7,
            "embedding_provider_name": "provider",
            "embedding_model_name": "model",
        },
        "keyword_setting": {"keyword_weight": 0.3},
    }
    if level == "weights":
        weights["unsupported"] = dict[str, object]()
    else:
        weights[level]["unsupported"] = "value"
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        InnerKnowledgeRetrieveWeights.model_validate(weights)


def test_multiple_retrieval_requires_weights_only_for_enabled_weighted_reranking() -> None:
    base_request = {
        "caller": {
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "user_id": "user-1",
            "user_from": "account",
            "invoke_from": "workflow",
        },
        "dataset_ids": ["dataset-1"],
        "query": "question",
    }
    with pytest.raises(ValidationError, match="retrieval.weights is required"):
        InnerKnowledgeRetrieveRequest.model_validate(
            {
                **base_request,
                "retrieval": {
                    "mode": "multiple",
                    "top_k": 1,
                    "reranking_enable": True,
                    "reranking_mode": "weighted_score",
                },
            }
        )

    default_config = InnerKnowledgeRetrieveRequest.model_validate(
        {**base_request, "retrieval": {"mode": "multiple", "top_k": 1}}
    ).retrieval
    assert default_config.reranking_enable is True
    assert default_config.reranking_model is None
