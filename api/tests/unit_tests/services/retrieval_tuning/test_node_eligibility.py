import json
from collections.abc import Collection, Mapping, Sequence
from dataclasses import replace
from uuid import uuid4

import pytest

from services.retrieval_tuning.feedback_volume import InvalidReportPageSizeError
from services.retrieval_tuning.node_eligibility import (
    DatasetFacts,
    NodeEligibilityCategory,
    NodeEligibilityRecord,
    NodeEligibilityService,
    PublishedAppGraph,
    PublishedAppGraphPage,
)

_TENANT_ID = "tenant"
_WEIGHTS = {"vector_setting": {"vector_weight": 0.7}, "keyword_setting": {"keyword_weight": 0.3}}
_DATASET_A = str(uuid4())
_DATASET_B = str(uuid4())


class _InMemoryQuery:
    """In-memory port implementation serving pages by keyset cursor and scoping datasets by tenant."""

    def __init__(
        self,
        pages: Mapping[str | None, PublishedAppGraphPage],
        datasets: Mapping[str, Sequence[DatasetFacts]] | None = None,
    ) -> None:
        self.pages = pages
        self.datasets = datasets or {}
        self.dataset_requests: list[tuple[str, set[str]]] = []

    def get_published_graphs_page(
        self,
        *,
        tenant_id: str | None,  # noqa: ARG002
        after_app_id: str | None,
        limit: int,  # noqa: ARG002
    ) -> PublishedAppGraphPage:
        return self.pages[after_app_id]

    def get_available_dataset_facts(self, *, tenant_id: str, dataset_ids: Collection[str]) -> Sequence[DatasetFacts]:
        self.dataset_requests.append((tenant_id, set(dataset_ids)))
        return [facts for facts in self.datasets.get(tenant_id, ()) if facts.dataset_id in dataset_ids]


def _facts(dataset_id: str = _DATASET_A, **overrides: object) -> DatasetFacts:
    base = DatasetFacts(
        dataset_id=dataset_id,
        provider="vendor",
        indexing_technique="high_quality",
        embedding_provider="provider",
        embedding_model="model",
        search_method="hybrid_search",
        reranking_mode="weighted_score",
        has_weights=True,
        vector_store="pgvector",
        has_parent_child_documents=False,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def _node(
    *,
    node_id: str = "node",
    dataset_ids: Sequence[str] = (_DATASET_A,),
    retrieval_mode: str = "multiple",
    config: Mapping[str, object] | None = None,
    **data: object,
) -> dict[str, object]:
    return {
        "id": node_id,
        "data": {
            "type": "knowledge-retrieval",
            "dataset_ids": list(dataset_ids),
            "retrieval_mode": retrieval_mode,
            "multiple_retrieval_config": {"top_k": 4, **(config or {})},
            **data,
        },
    }


def _graph(*nodes: object) -> str:
    return json.dumps({"nodes": list(nodes), "edges": []})


def _records(graph: str, *datasets: DatasetFacts) -> list[NodeEligibilityRecord]:
    page = PublishedAppGraphPage(
        records=[PublishedAppGraph(tenant_id=_TENANT_ID, app_id="app", workflow_id="workflow", graph=graph)],
        next_after_app_id=None,
    )
    query = _InMemoryQuery({None: page}, {_TENANT_ID: datasets})
    return list(NodeEligibilityService(query=query).report(tenant_id=None, page_size=10))


_WEIGHTED_NODE_CONFIG = {"reranking_mode": "weighted_score", "weights": _WEIGHTS}


@pytest.mark.parametrize(
    ("facts", "expected"),
    [
        (_facts(), NodeEligibilityCategory.SINGLE_DATASET_HYBRID_WEIGHTED),
        (_facts(has_weights=False), NodeEligibilityCategory.OTHER),
        (_facts(reranking_mode="reranking_model"), NodeEligibilityCategory.RERANK_MODEL),
        (_facts(reranking_mode=None), NodeEligibilityCategory.RERANK_MODEL),
        (_facts(reranking_mode="unknown"), NodeEligibilityCategory.OTHER),
        (_facts(search_method="semantic_search"), NodeEligibilityCategory.SEMANTIC_OR_FULLTEXT_ONLY),
        (_facts(search_method="full_text_search"), NodeEligibilityCategory.SEMANTIC_OR_FULLTEXT_ONLY),
        (_facts(search_method=None), NodeEligibilityCategory.SEMANTIC_OR_FULLTEXT_ONLY),
        (_facts(indexing_technique="economy"), NodeEligibilityCategory.ECONOMY),
        (_facts(provider="external"), NodeEligibilityCategory.EXTERNAL),
    ],
)
def test_single_dataset_nodes_are_classified_from_the_dataset(
    facts: DatasetFacts, expected: NodeEligibilityCategory
) -> None:
    assert _records(_graph(_node()), facts)[0].category == expected


def test_single_dataset_node_ignores_its_own_weights() -> None:
    semantic = _facts(search_method="semantic_search")

    record = _records(_graph(_node(config=_WEIGHTED_NODE_CONFIG)), semantic)[0]

    assert record.category == NodeEligibilityCategory.SEMANTIC_OR_FULLTEXT_ONLY


def test_single_available_dataset_uses_dataset_rules_when_node_lists_several() -> None:
    record = _records(_graph(_node(dataset_ids=[_DATASET_A, _DATASET_B], config=_WEIGHTED_NODE_CONFIG)), _facts())[0]

    assert record.category == NodeEligibilityCategory.SINGLE_DATASET_HYBRID_WEIGHTED
    assert (record.available_dataset_count, record.unavailable_dataset_count) == (1, 1)


@pytest.mark.parametrize(
    ("config", "second", "expected"),
    [
        (_WEIGHTED_NODE_CONFIG, {}, NodeEligibilityCategory.MULTI_DATASET_WEIGHTED),
        (_WEIGHTED_NODE_CONFIG, {"search_method": "semantic_search"}, NodeEligibilityCategory.MULTI_DATASET_WEIGHTED),
        (_WEIGHTED_NODE_CONFIG, {"embedding_model": "another"}, NodeEligibilityCategory.OTHER),
        (_WEIGHTED_NODE_CONFIG, {"embedding_provider": "another"}, NodeEligibilityCategory.OTHER),
        (_WEIGHTED_NODE_CONFIG, {"indexing_technique": "economy"}, NodeEligibilityCategory.ECONOMY),
        (_WEIGHTED_NODE_CONFIG, {"provider": "external"}, NodeEligibilityCategory.EXTERNAL),
        ({"reranking_mode": "weighted_score"}, {}, NodeEligibilityCategory.OTHER),
        ({**_WEIGHTED_NODE_CONFIG, "reranking_enable": False}, {}, NodeEligibilityCategory.OTHER),
        ({"reranking_mode": "reranking_model"}, {}, NodeEligibilityCategory.RERANK_MODEL),
        ({}, {}, NodeEligibilityCategory.RERANK_MODEL),
        ({"reranking_mode": "unknown"}, {}, NodeEligibilityCategory.OTHER),
    ],
)
def test_multiple_dataset_nodes_are_classified_from_the_node(
    config: Mapping[str, object], second: Mapping[str, object], expected: NodeEligibilityCategory
) -> None:
    node = _node(dataset_ids=[_DATASET_A, _DATASET_B], config=config)

    assert _records(_graph(node), _facts(), _facts(_DATASET_B, **second))[0].category == expected


def test_router_mode_and_nodes_without_usable_configuration() -> None:
    router = _node(retrieval_mode="single")
    no_config = {"id": "node", "data": {"type": "knowledge-retrieval", "dataset_ids": [], "retrieval_mode": "multiple"}}

    assert _records(_graph(router), _facts())[0].category == NodeEligibilityCategory.ROUTER_SINGLE
    assert _records(_graph(no_config))[0].category == NodeEligibilityCategory.OTHER
    assert _records(_graph(_node()))[0].category == NodeEligibilityCategory.OTHER


def test_record_reports_stores_parent_child_nesting_and_node_count() -> None:
    nodes = [
        _node(
            node_id="nested",
            dataset_ids=[_DATASET_A, _DATASET_B],
            iteration_id="iteration",
            config=_WEIGHTED_NODE_CONFIG,
        ),
        _node(node_id="looped", loop_id="loop"),
        {"id": "other", "data": {"type": "llm"}},
    ]
    datasets = (
        _facts(vector_store="qdrant", has_parent_child_documents=True),
        _facts(_DATASET_B, vector_store="pgvector"),
    )

    nested, looped = _records(_graph(*nodes), *datasets)

    assert nested.vector_stores == ("pgvector", "qdrant")
    assert nested.has_parent_child_documents is True
    assert nested.in_iteration_or_loop is True
    assert looped.in_iteration_or_loop is True
    assert nested.app_retrieval_node_count == 2


def test_v2_nodes_are_counted_separately_with_their_nesting() -> None:
    v2 = {"id": "v2", "data": {"type": "knowledge-retrieval-v2", "loop_id": "loop"}}

    record = _records(_graph(v2, _node()), _facts())[0]

    assert record.category == NodeEligibilityCategory.KNOWLEDGE_RETRIEVAL_V2
    assert record.in_iteration_or_loop is True
    assert record.app_retrieval_node_count == 2


@pytest.mark.parametrize("graph", ["not json", "[]", "{}", '{"nodes": "x"}', '{"nodes": ["x"]}', ""])
def test_malformed_graph_is_reported_and_later_apps_still_scan(graph: str) -> None:
    apps = [
        PublishedAppGraph(tenant_id=_TENANT_ID, app_id="bad", workflow_id="w1", graph=graph),
        PublishedAppGraph(tenant_id=_TENANT_ID, app_id="good", workflow_id="w2", graph=_graph(_node())),
    ]
    query = _InMemoryQuery(
        {None: PublishedAppGraphPage(records=apps, next_after_app_id=None)},
        {_TENANT_ID: [_facts()]},
    )

    bad, good = NodeEligibilityService(query=query).report(tenant_id=None, page_size=10)

    assert (bad.app_id, bad.node_id, bad.category) == ("bad", None, NodeEligibilityCategory.MALFORMED_GRAPH)
    assert good.category == NodeEligibilityCategory.SINGLE_DATASET_HYBRID_WEIGHTED


@pytest.mark.parametrize(
    ("node", "node_id"),
    [
        ({"id": "node", "data": {"type": "knowledge-retrieval"}}, "node"),
        ({"id": "node", "data": {"type": "knowledge-retrieval", "dataset_ids": "x"}}, "node"),
        (_node(config={"weights": "x"}), "node"),
        ({"data": {"type": "knowledge-retrieval", "dataset_ids": [], "retrieval_mode": "multiple"}}, None),
    ],
)
def test_malformed_retrieval_node_is_reported_without_hiding_the_rest(
    node: dict[str, object], node_id: str | None
) -> None:
    malformed, valid = _records(_graph(node, _node(node_id="valid")), _facts())

    assert (malformed.node_id, malformed.category) == (node_id, NodeEligibilityCategory.MALFORMED_NODE)
    assert valid.category == NodeEligibilityCategory.SINGLE_DATASET_HYBRID_WEIGHTED


def test_unrelated_nodes_with_odd_shapes_are_ignored() -> None:
    assert _records(_graph({"id": "note"}, {"id": "odd", "data": "text"}, {"data": {"type": "start"}})) == []


def test_non_uuid_dataset_ids_are_unavailable_and_never_reach_the_query() -> None:
    page = PublishedAppGraphPage(
        records=[
            PublishedAppGraph(
                tenant_id=_TENANT_ID,
                app_id="app",
                workflow_id="workflow",
                graph=_graph(_node(dataset_ids=["not-a-uuid", _DATASET_A])),
            )
        ],
        next_after_app_id=None,
    )
    query = _InMemoryQuery({None: page}, {_TENANT_ID: [_facts()]})

    record = next(NodeEligibilityService(query=query).report(tenant_id=None, page_size=10))

    assert query.dataset_requests == [(_TENANT_ID, {_DATASET_A})]
    assert (record.available_dataset_count, record.unavailable_dataset_count) == (1, 1)


def test_each_tenant_only_sees_its_own_datasets() -> None:
    graph = _graph(_node())
    apps = [
        PublishedAppGraph(tenant_id="tenant-a", app_id="a", workflow_id="w", graph=graph),
        PublishedAppGraph(tenant_id="tenant-b", app_id="b", workflow_id="w", graph=graph),
    ]
    query = _InMemoryQuery(
        {None: PublishedAppGraphPage(records=apps, next_after_app_id=None)},
        {"tenant-a": [_facts()]},
    )

    owned, foreign = NodeEligibilityService(query=query).report(tenant_id=None, page_size=10)

    assert owned.available_dataset_count == 1
    assert (foreign.available_dataset_count, foreign.category) == (0, NodeEligibilityCategory.OTHER)


def test_report_continues_past_empty_pages_until_the_scan_completes() -> None:
    query = _InMemoryQuery(
        {
            None: PublishedAppGraphPage(records=[], next_after_app_id="cursor"),
            "cursor": PublishedAppGraphPage(
                records=[PublishedAppGraph(tenant_id=_TENANT_ID, app_id="a", workflow_id="w", graph=_graph(_node()))],
                next_after_app_id=None,
            ),
        }
    )

    assert [record.app_id for record in NodeEligibilityService(query=query).report(tenant_id=None, page_size=1)] == [
        "a"
    ]


def test_report_rejects_a_non_positive_page_size_before_querying() -> None:
    with pytest.raises(InvalidReportPageSizeError):
        NodeEligibilityService(query=_InMemoryQuery({})).report(tenant_id=None, page_size=0)
