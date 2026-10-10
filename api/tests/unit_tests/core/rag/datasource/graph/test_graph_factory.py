"""Backend selection and the facade every caller goes through.

Indexing, retrieval and the console all talk to :class:`GraphStore` rather than
to a backend, so the facade has to pass every argument through untouched --
particularly the ``document_ids`` filter, which is what keeps a dataset's
document-level permissions from leaking through the graph.
"""

from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from core.rag.datasource.graph.graph_base import BaseGraphStore, GraphStats, StoredChunkLink, StoredEntity
from core.rag.datasource.graph.graph_factory import GraphStore
from core.rag.datasource.graph.neo4j.neo4j_graph_store import Neo4jGraphStore
from core.rag.datasource.graph.postgres.postgres_graph_store import PostgresGraphStore
from core.rag.graph.entities import ChunkGraph
from models.dataset import Dataset


def _dataset() -> Dataset:
    return Dataset(id="dataset-1", tenant_id="tenant-1", name="kb", created_by="user-1")


@pytest.fixture
def backend() -> MagicMock:
    return MagicMock()


@pytest.fixture
def store(backend: MagicMock) -> GraphStore:
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
    def test_writes_are_passed_through(self, store: GraphStore, backend: MagicMock, sqlite_session: Session) -> None:
        chunk_graphs: list[ChunkGraph] = []

        store.add_chunk_graphs(chunk_graphs, session=sqlite_session)
        store.delete_by_document_ids(["doc-1"], session=sqlite_session)
        store.delete_by_index_node_ids(["node-1"], session=sqlite_session)
        store.delete(session=sqlite_session)

        backend.add_chunk_graphs.assert_called_once_with(chunk_graphs, session=sqlite_session)
        backend.delete_by_document_ids.assert_called_once_with(["doc-1"], session=sqlite_session)
        backend.delete_by_index_node_ids.assert_called_once_with(["node-1"], session=sqlite_session)
        backend.delete.assert_called_once_with(session=sqlite_session)

    def test_reads_return_whatever_the_backend_returned(
        self, store: GraphStore, backend: MagicMock, sqlite_session: Session
    ) -> None:
        entities = store.get_entities_by_ids(["entity-1"], session=sqlite_session)

        assert entities is backend.get_entities_by_ids.return_value
        assert store.list_entities(10, session=sqlite_session) is backend.list_entities.return_value
        assert store.stats(session=sqlite_session) is backend.stats.return_value

        backend.get_entities_by_ids.assert_called_once_with(["entity-1"], session=sqlite_session)
        backend.list_entities.assert_called_once_with(10, session=sqlite_session)

    def test_the_document_filter_reaches_every_read_that_takes_one(
        self, store: GraphStore, backend: MagicMock, sqlite_session: Session
    ) -> None:
        document_ids = ["doc-1"]

        store.get_entities_by_names(["acme"], session=sqlite_session, document_ids=document_ids)
        store.search_entities(["acme"], 5, session=sqlite_session, document_ids=document_ids)
        store.get_relations(["entity-1"], 7, session=sqlite_session, document_ids=document_ids)
        store.get_chunk_links(["entity-1"], ["relation-1"], session=sqlite_session, document_ids=document_ids)

        # Dropping the filter anywhere here would let an excluded document seed
        # a query, bridge a multi-hop path, or be cited. The limits ride along
        # with it.
        backend.get_entities_by_names.assert_called_once_with(
            ["acme"], session=sqlite_session, document_ids=document_ids
        )
        backend.search_entities.assert_called_once_with(["acme"], 5, session=sqlite_session, document_ids=document_ids)
        backend.get_relations.assert_called_once_with(
            ["entity-1"], 7, session=sqlite_session, document_ids=document_ids
        )
        backend.get_chunk_links.assert_called_once_with(
            ["entity-1"], ["relation-1"], session=sqlite_session, document_ids=document_ids
        )

    def test_reads_default_to_no_document_filter(
        self, store: GraphStore, backend: MagicMock, sqlite_session: Session
    ) -> None:
        store.search_entities(["acme"], 5, session=sqlite_session)

        backend.search_entities.assert_called_once_with(["acme"], 5, session=sqlite_session, document_ids=None)


class TestStorageContract:
    """Every backend method is abstract; none of them has a usable default."""

    def test_no_method_has_a_silent_default_implementation(self, sqlite_session: Session) -> None:
        backend = MagicMock()
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
