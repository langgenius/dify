from dataclasses import dataclass, field

import pytest
from pydantic import ValidationError

from machinery.context import RequestContext
from services.errors.knowledge_retrieval import InnerKnowledgeRetrieveAppNotFoundError
from services.knowledge.entities.inner_retrieval import (
    InnerKnowledgeRetrieveRequest,
    InnerKnowledgeRetrieveResult,
    InnerKnowledgeRetrieveUsage,
    InnerKnowledgeRetrieveWeights,
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
    calls: list[tuple[RequestContext, InnerKnowledgeRetrieveRequest]] = field(default_factory=list)

    def retrieve(self, context: RequestContext, request: InnerKnowledgeRetrieveRequest) -> InnerKnowledgeRetrieveResult:
        self.events.append("retrieval")
        self.calls.append((context, request))
        return InnerKnowledgeRetrieveResult(
            results=[],
            usage=InnerKnowledgeRetrieveUsage(
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                prompt_unit_price="0",
                completion_unit_price="0",
                prompt_price_unit="0.001",
                completion_price_unit="0.001",
                prompt_price="0",
                completion_price="0",
                total_price="0",
                latency=0,
            ),
        )


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
        assert retrieval.calls == [(context, request)]
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
        weights["unsupported"] = {}
    else:
        weights[level]["unsupported"] = "value"
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        InnerKnowledgeRetrieveWeights.model_validate(weights)
