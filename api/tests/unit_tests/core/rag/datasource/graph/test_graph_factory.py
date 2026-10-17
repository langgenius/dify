"""Backend selection and the facade every caller goes through.

Indexing, retrieval and the console all talk to :class:`GraphStore` rather than
to a backend, so the facade has to pass every argument through untouched --
particularly the ``document_ids`` filter, which is what keeps a dataset's
document-level permissions from leaking through the graph.
"""

from collections.abc import Callable
from typing import override

import pytest
from sqlalchemy.orm import Session

from core.rag.datasource.graph.graph_base import (
    BaseGraphStore,
    GraphStats,
    StoredChunkLink,
    StoredEntity,
    StoredRelation,
)
from core.rag.datasource.graph.graph_factory import GraphStore
from core.rag.datasource.graph.neo4j.neo4j_graph_store import Neo4jGraphStore
from core.rag.datasource.graph.postgres.postgres_graph_store import PostgresGraphStore
from core.rag.graph.entities import ChunkGraph
from models.dataset import Dataset

type Call = tuple[str, tuple[object, ...], dict[str, object]]


def _dataset() -> Dataset:
    return Dataset(id="dataset-1", tenant_id="tenant-1", name="kb", created_by="user-1")


class _RecordingBackend(BaseGraphStore):
    """A complete backend that records every call and answers with fixed rows."""

    def __init__(self) -> None:
        super().__init__(_dataset())
        self.calls: list[Call] = []
        self.entities = [StoredEntity(id="entity-1", name="acme", display_name="Acme", entity_type="ORGANIZATION")]
        self.relations: list[StoredRelation] = []
        self.links: list[StoredChunkLink] = []
        self.graph_stats = GraphStats(entity_count=1)

    @override
    def add_chunk_graphs(self, chunk_graphs: list[ChunkGraph], *, session: Session) -> None:
        self.calls.append(("add_chunk_graphs", (chunk_graphs,), {"session": session}))

    @override
    def delete_by_document_ids(self, document_ids: list[str], *, session: Session) -> None:
        self.calls.append(("delete_by_document_ids", (document_ids,), {"session": session}))

    @override
    def delete_by_index_node_ids(self, index_node_ids: list[str], *, session: Session) -> None:
        self.calls.append(("delete_by_index_node_ids", (index_node_ids,), {"session": session}))

    @override
    def delete(self, *, session: Session) -> None:
        self.calls.append(("delete", (), {"session": session}))

    @override
    def get_entities_by_names(
        self, names: list[str], *, session: Session, document_ids: list[str] | None = None
    ) -> list[StoredEntity]:
        self.calls.append(("get_entities_by_names", (names,), {"session": session, "document_ids": document_ids}))
        return self.entities

    @override
    def search_entities(
        self, keywords: list[str], limit: int, *, session: Session, document_ids: list[str] | None = None
    ) -> list[StoredEntity]:
        self.calls.append(("search_entities", (keywords, limit), {"session": session, "document_ids": document_ids}))
        return self.entities

    @override
    def get_relations(
        self, entity_ids: list[str], limit: int, *, session: Session, document_ids: list[str] | None = None
    ) -> list[StoredRelation]:
        self.calls.append(("get_relations", (entity_ids, limit), {"session": session, "document_ids": document_ids}))
        return self.relations

    @override
    def get_entities_by_ids(self, entity_ids: list[str], *, session: Session) -> list[StoredEntity]:
        self.calls.append(("get_entities_by_ids", (entity_ids,), {"session": session}))
        return self.entities

    @override
    def list_entities(self, limit: int, *, session: Session) -> list[StoredEntity]:
        self.calls.append(("list_entities", (limit,), {"session": session}))
        return self.entities

    @override
    def get_chunk_links(
        self,
        entity_ids: list[str],
        relation_ids: list[str],
        *,
        session: Session,
        document_ids: list[str] | None = None,
    ) -> list[StoredChunkLink]:
        self.calls.append(
            ("get_chunk_links", (entity_ids, relation_ids), {"session": session, "document_ids": document_ids})
        )
        return self.links

    @override
    def stats(self, *, session: Session) -> GraphStats:
        self.calls.append(("stats", (), {"session": session}))
        return self.graph_stats


@pytest.fixture
def backend() -> _RecordingBackend:
    return _RecordingBackend()


@pytest.fixture
def store(backend: _RecordingBackend) -> GraphStore:
    """A facade over a recording backend, bypassing backend selection."""
    store = GraphStore.__new__(GraphStore)
    store._dataset = _dataset()
    store._store = backend
    return store


class TestBackendSelection:
    def test_postgres_is_selected_by_name(self) -> None:
        assert GraphStore.get_graph_factory("postgres") is PostgresGraphStore

    def test_neo4j_is_selected_by_name(self) -> None:
        assert GraphStore.get_graph_factory("neo4j") is Neo4jGraphStore

    def test_an_unknown_backend_fails_loudly(self) -> None:
        # A typo in GRAPH_STORE must not quietly fall back to a backend that
        # would then look like an empty graph.
        with pytest.raises(ValueError, match="not supported"):
            GraphStore.get_graph_factory("janusgraph")

    def test_the_configured_backend_is_the_one_built(
        self, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
    ) -> None:
        config_overrides(GRAPH_STORE="neo4j")
        monkeypatch.setattr(Neo4jGraphStore, "_ensure_schema", lambda _self: None)

        assert isinstance(GraphStore(_dataset())._store, Neo4jGraphStore)


class TestDelegation:
    def test_writes_are_passed_through(
        self, store: GraphStore, backend: _RecordingBackend, sqlite_session: Session
    ) -> None:
        chunk_graphs: list[ChunkGraph] = []

        store.add_chunk_graphs(chunk_graphs, session=sqlite_session)
        store.delete_by_document_ids(["doc-1"], session=sqlite_session)
        store.delete_by_index_node_ids(["node-1"], session=sqlite_session)
        store.delete(session=sqlite_session)

        assert backend.calls == [
            ("add_chunk_graphs", (chunk_graphs,), {"session": sqlite_session}),
            ("delete_by_document_ids", (["doc-1"],), {"session": sqlite_session}),
            ("delete_by_index_node_ids", (["node-1"],), {"session": sqlite_session}),
            ("delete", (), {"session": sqlite_session}),
        ]

    def test_reads_return_whatever_the_backend_returned(
        self, store: GraphStore, backend: _RecordingBackend, sqlite_session: Session
    ) -> None:
        entities = store.get_entities_by_ids(["entity-1"], session=sqlite_session)

        assert entities is backend.entities
        assert store.list_entities(10, session=sqlite_session) is backend.entities
        assert store.stats(session=sqlite_session) is backend.graph_stats

        assert backend.calls == [
            ("get_entities_by_ids", (["entity-1"],), {"session": sqlite_session}),
            ("list_entities", (10,), {"session": sqlite_session}),
            ("stats", (), {"session": sqlite_session}),
        ]

    def test_the_document_filter_reaches_every_read_that_takes_one(
        self, store: GraphStore, backend: _RecordingBackend, sqlite_session: Session
    ) -> None:
        document_ids = ["doc-1"]

        store.get_entities_by_names(["acme"], session=sqlite_session, document_ids=document_ids)
        store.search_entities(["acme"], 5, session=sqlite_session, document_ids=document_ids)
        store.get_relations(["entity-1"], 7, session=sqlite_session, document_ids=document_ids)
        store.get_chunk_links(["entity-1"], ["relation-1"], session=sqlite_session, document_ids=document_ids)

        # Dropping the filter anywhere here would let an excluded document seed
        # a query, bridge a multi-hop path, or be cited. The limits ride along
        # with it.
        filtered = {"session": sqlite_session, "document_ids": document_ids}
        assert backend.calls == [
            ("get_entities_by_names", (["acme"],), filtered),
            ("search_entities", (["acme"], 5), filtered),
            ("get_relations", (["entity-1"], 7), filtered),
            ("get_chunk_links", (["entity-1"], ["relation-1"]), filtered),
        ]

    def test_reads_default_to_no_document_filter(
        self, store: GraphStore, backend: _RecordingBackend, sqlite_session: Session
    ) -> None:
        store.search_entities(["acme"], 5, session=sqlite_session)

        assert backend.calls == [("search_entities", (["acme"], 5), {"session": sqlite_session, "document_ids": None})]


class TestStorageContract:
    """Every backend method is abstract; none of them has a usable default."""

    def test_no_method_has_a_silent_default_implementation(
        self, backend: _RecordingBackend, sqlite_session: Session
    ) -> None:
        # A default that returned nothing instead of raising would surface as an
        # empty graph rather than as a backend somebody forgot to finish.
        calls: list[Callable[[], object]] = [
            lambda: BaseGraphStore.add_chunk_graphs(backend, [], session=sqlite_session),
            lambda: BaseGraphStore.delete_by_document_ids(backend, [], session=sqlite_session),
            lambda: BaseGraphStore.delete_by_index_node_ids(backend, [], session=sqlite_session),
            lambda: BaseGraphStore.delete(backend, session=sqlite_session),
            lambda: BaseGraphStore.get_entities_by_names(backend, [], session=sqlite_session),
            lambda: BaseGraphStore.search_entities(backend, [], 1, session=sqlite_session),
            lambda: BaseGraphStore.get_relations(backend, [], 1, session=sqlite_session),
            lambda: BaseGraphStore.get_entities_by_ids(backend, [], session=sqlite_session),
            lambda: BaseGraphStore.list_entities(backend, 1, session=sqlite_session),
            lambda: BaseGraphStore.get_chunk_links(backend, [], [], session=sqlite_session),
            lambda: BaseGraphStore.stats(backend, session=sqlite_session),
        ]

        for call in calls:
            with pytest.raises(NotImplementedError):
                call()

    def test_an_incomplete_backend_cannot_be_instantiated(self) -> None:
        class _MissingEverything(BaseGraphStore):
            pass

        with pytest.raises(TypeError, match="abstract"):
            _MissingEverything(_dataset())  # type: ignore[abstract]

    def test_the_backend_agnostic_models_carry_the_defaults_callers_rely_on(self) -> None:
        entity = StoredEntity(id="entity-1", name="acme", display_name="Acme", entity_type="ORGANIZATION")
        link = StoredChunkLink(index_node_id="node-1", document_id="doc-1", entity_id="entity-1")

        assert entity.frequency == 1
        # A link carries provenance for a node or an edge, never both.
        assert link.relation_id is None
        assert GraphStats().entity_types == {}
