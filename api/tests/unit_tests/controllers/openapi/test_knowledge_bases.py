from dataclasses import dataclass, field
from inspect import unwrap
from typing import cast

import pytest

from controllers.openapi._models import KNOWLEDGE_TOP_K
from controllers.openapi.auth.context import Context
from controllers.openapi.knowledge_bases import KnowledgeBasesApi, knowledge_base_row
from machinery.context import RequestContext
from services.knowledge.datasets.contracts import DatasetListFilter
from services.knowledge.entities.datasets import DatasetDetailRecord, DatasetPage

REQUEST_CONTEXT = RequestContext("request-1", "trace-1", "account-1", "workspace-1")


def _record(**extra: object) -> dict[str, object]:
    return {
        "id": "ds-1",
        "name": "Docs",
        "description": None,
        "provider": "vendor",
        "indexing_technique": "high_quality",
        "document_count": 3,
        "embedding_available": True,
        **extra,
    }


def _page() -> DatasetPage:
    return {
        "data": [cast(DatasetDetailRecord, _record())],
        "has_more": True,
        "total": 3,
        "page": 2,
        "limit": 1,
    }


@dataclass
class AccountVisibleDatasetServiceFake:
    calls: list[tuple[RequestContext, DatasetListFilter]] = field(default_factory=list)

    def list_accessible_datasets(self, context: RequestContext, query: DatasetListFilter) -> DatasetPage:
        self.calls.append((context, query))
        return _page()


@dataclass(frozen=True)
class KnowledgeServicesFake:
    datasets: AccountVisibleDatasetServiceFake


@dataclass(frozen=True)
class ApplicationServicesFake:
    knowledge: KnowledgeServicesFake


@dataclass(frozen=True)
class ContextFake:
    request_context: RequestContext


def test_row_carries_a_retrieval_fragment() -> None:
    row = knowledge_base_row(_record())
    assert row.node_data.dataset_ids == ["ds-1"]
    assert row.node_data.retrieval_mode == "multiple"
    assert row.node_data.multiple_retrieval_config.top_k == KNOWLEDGE_TOP_K
    assert row.node_data.multiple_retrieval_config.reranking_enable is False


def test_unavailable_embedding_is_reported() -> None:
    assert knowledge_base_row(_record(embedding_available=False)).usable is False
    assert knowledge_base_row(_record(embedding_available=None, provider="external")).usable is True


def test_list_delegates_to_account_visible_use_case_and_serializes_page(monkeypatch: pytest.MonkeyPatch) -> None:
    from controllers.openapi import knowledge_bases as controller
    from controllers.openapi._models import KnowledgeBaseListQuery

    datasets = AccountVisibleDatasetServiceFake()
    services = ApplicationServicesFake(knowledge=KnowledgeServicesFake(datasets=datasets))
    monkeypatch.setattr(controller, "application_services", lambda: services)
    query = KnowledgeBaseListQuery(page=2, limit=1, query="Docs")

    response = unwrap(KnowledgeBasesApi.get)(
        KnowledgeBasesApi(), cast(Context, ContextFake(REQUEST_CONTEXT)), "workspace-1", query=query
    )

    assert datasets.calls == [(REQUEST_CONTEXT, DatasetListFilter(page=2, limit=1, keyword="Docs"))]
    assert (response.page, response.limit, response.total, response.has_more) == (2, 1, 3, True)
    [row] = response.data
    assert (row.id, row.name, row.document_count, row.usable) == ("ds-1", "Docs", 3, True)
    assert row.node_data.dataset_ids == ["ds-1"]
    assert row.node_data.retrieval_mode == "multiple"
