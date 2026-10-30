"""Classify published knowledge retrieval nodes by whether their weights could be tuned.

Boundary: a read-only operator report. Output holds identifiers, categories, and
vector store names, never node titles, dataset names, or query text.

Invariants:
- Only the published workflow of a Chatflow (advanced-chat) app is scanned, because
  drafts serve no traffic.
- Each node gets exactly one category, matching how retrieval runs today: a node with
  one available dataset uses the dataset's retrieval model, and a node with several
  uses its own rerank configuration, because retrieval skips node-level reranking for
  a single dataset.
- Only datasets retrieval could use are counted: owned by the app's tenant, and
  external or holding at least one completed, enabled, unarchived document.
- A malformed graph or node produces a reported row instead of stopping the scan.

This module stays free of the execution kernel, so it restates the persisted graph and
retrieval model values it reads as literals. These are stored data, not kernel behavior.
"""

from collections.abc import Collection, Iterator, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, ValidationError

from services.retrieval_tuning.feedback_volume import InvalidReportPageSizeError

_KNOWLEDGE_RETRIEVAL_NODE_TYPE = "knowledge-retrieval"
_KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE = "knowledge-retrieval-v2"
_HYBRID_SEARCH = "hybrid_search"
_WEIGHTED_SCORE = "weighted_score"
_RERANKING_MODEL = "reranking_model"
_EXTERNAL_PROVIDER = "external"
_ECONOMY_INDEXING = "economy"


class NodeEligibilityCategory(StrEnum):
    SINGLE_DATASET_HYBRID_WEIGHTED = "single_dataset_hybrid_weighted"
    MULTI_DATASET_WEIGHTED = "multi_dataset_weighted"
    RERANK_MODEL = "rerank_model"
    ROUTER_SINGLE = "router_single"
    ECONOMY = "economy"
    EXTERNAL = "external"
    SEMANTIC_OR_FULLTEXT_ONLY = "semantic_or_fulltext_only"
    OTHER = "other"
    KNOWLEDGE_RETRIEVAL_V2 = "knowledge_retrieval_v2"
    MALFORMED_NODE = "malformed_node"
    MALFORMED_GRAPH = "malformed_graph"


@dataclass(frozen=True, slots=True)
class PublishedAppGraph:
    """The serialized graph of one app's published workflow, exactly as stored."""

    tenant_id: str
    app_id: str
    workflow_id: str
    graph: str


@dataclass(frozen=True, slots=True)
class PublishedAppGraphPage:
    """One page of apps; next_after_app_id is None when the scan is complete."""

    records: Sequence[PublishedAppGraph]
    next_after_app_id: str | None


@dataclass(frozen=True, slots=True)
class DatasetFacts:
    """Retrieval facts for one available dataset.

    search_method None means the dataset has no retrieval model, so retrieval uses its
    semantic default. reranking_mode None means the retrieval model does not set one.
    vector_store None means the dataset records no index structure yet.
    """

    dataset_id: str
    provider: str
    indexing_technique: str | None
    embedding_provider: str | None
    embedding_model: str | None
    search_method: str | None
    reranking_mode: str | None
    has_weights: bool
    vector_store: str | None
    has_parent_child_documents: bool


@dataclass(frozen=True, slots=True)
class NodeEligibilityRecord:
    """One report row.

    node_id None means the row describes a whole malformed graph, or a retrieval node
    with no usable id. Dataset fields are zero or empty for KnowledgeFS v2 and malformed
    rows, which have no datasets to classify.
    """

    tenant_id: str
    app_id: str
    workflow_id: str
    node_id: str | None
    category: NodeEligibilityCategory
    available_dataset_count: int
    unavailable_dataset_count: int
    vector_stores: tuple[str, ...]
    has_parent_child_documents: bool
    in_iteration_or_loop: bool
    app_retrieval_node_count: int


class NodeEligibilityQuery(Protocol):
    def get_published_graphs_page(
        self, *, tenant_id: str | None, after_app_id: str | None, limit: int
    ) -> PublishedAppGraphPage:
        """Return one page of published Chatflow graphs, ordered by app id.

        Owner scope: tenant_id limits the scan to one tenant; None scans every tenant and
        is reserved for operators. The workflow must belong to the same app and tenant.
        Apps with no published workflow are omitted. Requires a positive limit. Runs in
        one short read session and writes nothing. Raises only database errors.
        """
        ...

    def get_available_dataset_facts(self, *, tenant_id: str, dataset_ids: Collection[str]) -> Sequence[DatasetFacts]:
        """Return facts for the listed datasets that retrieval could use.

        Owner scope: only datasets in tenant_id are returned, whatever ids are requested.
        A dataset qualifies when it is external or has a completed, enabled, unarchived
        document. Requires well-formed UUID strings. Runs in one short read session and
        writes nothing. Unreadable stored settings read as absent. Raises only database
        errors.
        """
        ...


class _MultipleRetrievalConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Absent values use the defaults of the node's own configuration entity.
    reranking_mode: str = _RERANKING_MODEL
    reranking_enable: bool = True
    weights: dict[str, object] | None = None


class _RetrievalNodeData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    dataset_ids: list[str]
    retrieval_mode: str | None = None
    multiple_retrieval_config: _MultipleRetrievalConfig | None = None
    iteration_id: str | None = None
    loop_id: str | None = None


class _GraphDocument(BaseModel):
    model_config = ConfigDict(extra="ignore")

    nodes: list[dict[str, object]]


@dataclass(frozen=True, slots=True)
class _ValidRetrievalNode:
    node_id: str
    data: _RetrievalNodeData


@dataclass(frozen=True, slots=True)
class _V2RetrievalNode:
    node_id: str | None
    in_iteration_or_loop: bool


@dataclass(frozen=True, slots=True)
class _MalformedRetrievalNode:
    node_id: str | None


type _ScannedNode = _ValidRetrievalNode | _V2RetrievalNode | _MalformedRetrievalNode


class NodeEligibilityService:
    def __init__(self, *, query: NodeEligibilityQuery) -> None:
        self._query: NodeEligibilityQuery = query

    def report(self, *, tenant_id: str | None, page_size: int) -> Iterator[NodeEligibilityRecord]:
        """Stream one row per retrieval node, and one per malformed graph, ordered by app id.

        Requires a positive page_size; tenant_id None means every tenant. An invalid
        page_size raises InvalidReportPageSizeError before any query runs. The result is
        lazy and holds no session between pages. It has no side effects, malformed stored
        graphs never raise, and database failures propagate to the consumer.
        """
        if page_size <= 0:
            raise InvalidReportPageSizeError(f"Report page size must be positive, got {page_size}")
        return self._iter_records(tenant_id=tenant_id, page_size=page_size)

    def _iter_records(self, *, tenant_id: str | None, page_size: int) -> Iterator[NodeEligibilityRecord]:
        """Walk the app keyset until the query reports no successor page."""
        after_app_id: str | None = None
        has_more = True
        while has_more:
            page = self._query.get_published_graphs_page(
                tenant_id=tenant_id, after_app_id=after_app_id, limit=page_size
            )
            yield from self._page_records(page.records)
            after_app_id = page.next_after_app_id
            has_more = after_app_id is not None

    def _page_records(self, apps: Sequence[PublishedAppGraph]) -> Iterator[NodeEligibilityRecord]:
        """Classify one page, loading each tenant's referenced datasets in one bounded query."""
        scanned = [(app, _scan_graph(app.graph)) for app in apps]
        requested: dict[str, set[str]] = {}
        for app, nodes in scanned:
            requested.setdefault(app.tenant_id, set()).update(
                dataset_id
                for node in nodes or ()
                if isinstance(node, _ValidRetrievalNode)
                for dataset_id in node.data.dataset_ids
                if _is_uuid(dataset_id)
            )
        facts_by_tenant = {
            tenant_id: {
                facts.dataset_id: facts
                for facts in self._query.get_available_dataset_facts(tenant_id=tenant_id, dataset_ids=dataset_ids)
            }
            for tenant_id, dataset_ids in requested.items()
        }
        for app, nodes in scanned:
            yield from _app_records(app, nodes, facts_by_tenant.get(app.tenant_id, {}))


def _is_uuid(value: str) -> bool:
    """Report whether a stored dataset id can be bound as a UUID without a database error."""
    try:
        UUID(value)
    except ValueError:
        return False
    return True


def _scan_graph(graph: str) -> list[_ScannedNode] | None:
    """Return the graph's retrieval nodes in stored order; None means the graph is malformed."""
    try:
        document = _GraphDocument.model_validate_json(graph)
    except ValidationError:
        return None
    return [scanned for node in document.nodes if (scanned := _scan_node(node)) is not None]


def _scan_node(node: Mapping[str, object]) -> _ScannedNode | None:
    """Validate one graph node; None means it is not a retrieval node, whatever else it holds."""
    data = node.get("data")
    if not isinstance(data, dict):
        return None
    raw_id = node.get("id")
    node_id = raw_id if isinstance(raw_id, str) and raw_id else None
    node_type = data.get("type")
    if node_type == _KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE:
        return _V2RetrievalNode(
            node_id=node_id, in_iteration_or_loop=bool(data.get("iteration_id") or data.get("loop_id"))
        )
    if node_type == _KNOWLEDGE_RETRIEVAL_NODE_TYPE:
        return _scan_retrieval_node(node_id, data)
    return None


def _scan_retrieval_node(
    node_id: str | None, data: Mapping[str, object]
) -> _ValidRetrievalNode | _MalformedRetrievalNode:
    """Validate a v1 retrieval node's data; a missing id or invalid shape is malformed."""
    try:
        validated = _RetrievalNodeData.model_validate(data)
    except ValidationError:
        return _MalformedRetrievalNode(node_id=node_id)
    if node_id is None:
        return _MalformedRetrievalNode(node_id=None)
    return _ValidRetrievalNode(node_id=node_id, data=validated)


def _app_records(
    app: PublishedAppGraph,
    nodes: Sequence[_ScannedNode] | None,
    facts: Mapping[str, DatasetFacts],
) -> list[NodeEligibilityRecord]:
    """Build one app's rows; a malformed graph yields exactly one row with no node id."""
    if nodes is None:
        return [_row_without_datasets(app, None, NodeEligibilityCategory.MALFORMED_GRAPH, False, 0)]
    return [_node_record(app, node, facts, len(nodes)) for node in nodes]


def _node_record(
    app: PublishedAppGraph, node: _ScannedNode, facts: Mapping[str, DatasetFacts], node_count: int
) -> NodeEligibilityRecord:
    match node:
        case _V2RetrievalNode():
            return _row_without_datasets(
                app,
                node.node_id,
                NodeEligibilityCategory.KNOWLEDGE_RETRIEVAL_V2,
                node.in_iteration_or_loop,
                node_count,
            )
        case _MalformedRetrievalNode():
            return _row_without_datasets(app, node.node_id, NodeEligibilityCategory.MALFORMED_NODE, False, node_count)
        case _ValidRetrievalNode():
            configured = set(node.data.dataset_ids)
            available = [facts[dataset_id] for dataset_id in sorted(configured) if dataset_id in facts]
            return NodeEligibilityRecord(
                tenant_id=app.tenant_id,
                app_id=app.app_id,
                workflow_id=app.workflow_id,
                node_id=node.node_id,
                category=_classify_retrieval_node(node.data, available),
                available_dataset_count=len(available),
                unavailable_dataset_count=len(configured) - len(available),
                vector_stores=tuple(sorted({item.vector_store for item in available if item.vector_store})),
                has_parent_child_documents=any(item.has_parent_child_documents for item in available),
                in_iteration_or_loop=bool(node.data.iteration_id or node.data.loop_id),
                app_retrieval_node_count=node_count,
            )


def _row_without_datasets(
    app: PublishedAppGraph,
    node_id: str | None,
    category: NodeEligibilityCategory,
    in_iteration_or_loop: bool,
    node_count: int,
) -> NodeEligibilityRecord:
    return NodeEligibilityRecord(
        tenant_id=app.tenant_id,
        app_id=app.app_id,
        workflow_id=app.workflow_id,
        node_id=node_id,
        category=category,
        available_dataset_count=0,
        unavailable_dataset_count=0,
        vector_stores=(),
        has_parent_child_documents=False,
        in_iteration_or_loop=in_iteration_or_loop,
        app_retrieval_node_count=node_count,
    )


def _classify_retrieval_node(node: _RetrievalNodeData, datasets: Sequence[DatasetFacts]) -> NodeEligibilityCategory:
    """Return the one category describing how this node's weights behave at runtime.

    datasets must be the node's available datasets. Pure and total: configurations that
    retrieval would reject or run without a reranker, such as weighted score without
    weights or mixed embedding models, are OTHER because no weight can be tuned.
    """
    config = node.multiple_retrieval_config
    if node.retrieval_mode == "single":
        return NodeEligibilityCategory.ROUTER_SINGLE
    if node.retrieval_mode != "multiple" or config is None or not datasets:
        return NodeEligibilityCategory.OTHER
    if any(dataset.provider == _EXTERNAL_PROVIDER for dataset in datasets):
        return NodeEligibilityCategory.EXTERNAL
    if any(dataset.indexing_technique == _ECONOMY_INDEXING for dataset in datasets):
        return NodeEligibilityCategory.ECONOMY
    if len(datasets) == 1:
        return _classify_single_dataset(datasets[0])
    return _classify_multiple_datasets(config, datasets)


def _classify_single_dataset(dataset: DatasetFacts) -> NodeEligibilityCategory:
    """Classify from the dataset's retrieval model, since node-level reranking is skipped."""
    if dataset.search_method != _HYBRID_SEARCH:
        return NodeEligibilityCategory.SEMANTIC_OR_FULLTEXT_ONLY
    if dataset.reranking_mode == _WEIGHTED_SCORE:
        return (
            NodeEligibilityCategory.SINGLE_DATASET_HYBRID_WEIGHTED
            if dataset.has_weights
            else NodeEligibilityCategory.OTHER
        )
    # An unset reranking mode falls back to the reranking model at runtime.
    if dataset.reranking_mode in {None, _RERANKING_MODEL}:
        return NodeEligibilityCategory.RERANK_MODEL
    return NodeEligibilityCategory.OTHER


def _classify_multiple_datasets(
    config: _MultipleRetrievalConfig, datasets: Sequence[DatasetFacts]
) -> NodeEligibilityCategory:
    """Classify from the node's rerank configuration, which fuses results across datasets."""
    if not config.reranking_enable:
        return NodeEligibilityCategory.OTHER
    if config.reranking_mode == _RERANKING_MODEL:
        return NodeEligibilityCategory.RERANK_MODEL
    same_embedding = len({(dataset.embedding_provider, dataset.embedding_model) for dataset in datasets}) == 1
    if config.reranking_mode == _WEIGHTED_SCORE and config.weights is not None and same_embedding:
        return NodeEligibilityCategory.MULTI_DATASET_WEIGHTED
    return NodeEligibilityCategory.OTHER
