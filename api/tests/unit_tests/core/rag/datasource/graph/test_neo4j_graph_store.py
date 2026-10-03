"""The Neo4j backend, driven against a fake driver.

Neo4j is an optional backend (``uv sync --group graph-neo4j``) and CI has no
server to talk to, so the driver is replaced with a recorder: the tests assert
on the statements the store issues and on how it maps records back into the
backend-agnostic ``Stored*`` models, which is the part of this file that has to
stay in step with the Postgres backend.
"""

import sys
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from types import ModuleType
from typing import cast

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.graph.neo4j import neo4j_graph_store as neo4j_module
from core.rag.datasource.graph.neo4j.neo4j_graph_store import Neo4jGraphStore
from core.rag.graph.entities import UNKNOWN_ENTITY_TYPE, ChunkGraph, GraphEntity, GraphExtraction, GraphRelation
from models.dataset import Dataset

DATASET_ID = "dataset-1"
TENANT_ID = "tenant-1"


def _dataset() -> Dataset:
    return Dataset(
        id=DATASET_ID,
        tenant_id=TENANT_ID,
        name="kb",
        created_by="user-1",
        graph_index_setting={"enabled": True},
    )


def _chunk_graph(
    index_node_id: str,
    document_id: str,
    entities: list[GraphEntity] | None = None,
    relations: list[GraphRelation] | None = None,
) -> ChunkGraph:
    return ChunkGraph(
        index_node_id=index_node_id,
        document_id=document_id,
        extraction=GraphExtraction(entities=entities or [], relations=relations or []),
    )


def _entity(name: str, entity_type: str = "ORGANIZATION") -> GraphEntity:
    return GraphEntity(name=name, display_name=name.title(), entity_type=entity_type, description="desc")


def _merged_rows(params: dict[str, object]) -> list[dict[str, str]]:
    """The ``rows`` payload a merge statement was given, typed for assertions."""
    return cast(list[dict[str, str]], params["rows"])


class _FakeResult:
    """Stands in for a neo4j ``Result``: iterable, with ``single()``."""

    def __init__(self, records: list[dict[str, object]]) -> None:
        self._records = records

    def __iter__(self) -> Iterator[dict[str, object]]:
        return iter(self._records)

    def single(self) -> dict[str, object] | None:
        return self._records[0] if self._records else None


class _FakeSession:
    """Records every statement and replays canned records for matching ones.

    Sessions and transactions both expose ``run``, so the same recorder plays
    the transaction handed to ``execute_write``; what the tests are about is the
    statements issued, not which object issued them.
    """

    def __init__(self, results: dict[str, list[dict[str, object]]] | None = None) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.write_transactions = 0
        self._results = results or {}

    def __enter__(self) -> "_FakeSession":
        return self

    def __exit__(self, *exc_info: object) -> bool:
        return False

    def run(self, query: str, **params: object) -> _FakeResult:
        self.calls.append((query, params))
        for needle, records in self._results.items():
            if needle in query:
                return _FakeResult(records)
        return _FakeResult([])

    def execute_write(self, unit_of_work: Callable[["_FakeSession"], None]) -> None:
        self.write_transactions += 1
        unit_of_work(self)

    def queries_matching(self, needle: str) -> list[tuple[str, dict[str, object]]]:
        return [call for call in self.calls if needle in call[0]]

    def index_of(self, needle: str) -> int:
        for position, (query, _) in enumerate(self.calls):
            if needle in query:
                return position
        raise AssertionError(f"no statement containing {needle!r} was issued")


class _FakeDriver:
    def __init__(self, session: _FakeSession) -> None:
        self._session = session
        self.databases: list[str | None] = []

    def session(self, database: str | None = None) -> _FakeSession:
        self.databases.append(database)
        return self._session


@pytest.fixture
def session(sqlite_session_factory: sessionmaker[Session]) -> Iterator[Session]:
    """The SQLAlchemy session the interface requires and this backend ignores."""
    with sqlite_session_factory() as session:
        yield session


@pytest.fixture
def neo_session() -> _FakeSession:
    return _FakeSession()


@pytest.fixture
def driver(neo_session: _FakeSession, monkeypatch: pytest.MonkeyPatch) -> _FakeDriver:
    driver = _FakeDriver(neo_session)
    monkeypatch.setattr(neo4j_module, "_get_driver", lambda: driver)
    monkeypatch.setattr(neo4j_module, "_driver", driver)
    return driver


@pytest.fixture
def install_driver(monkeypatch: pytest.MonkeyPatch) -> Callable[[_FakeSession], _FakeDriver]:
    """Install a driver whose session replays canned records."""

    def _install(neo_session: _FakeSession) -> _FakeDriver:
        driver = _FakeDriver(neo_session)
        monkeypatch.setattr(neo4j_module, "_schema_ready", True)
        monkeypatch.setattr(neo4j_module, "_get_driver", lambda: driver)
        monkeypatch.setattr(neo4j_module, "_driver", driver)
        return driver

    return _install


@pytest.fixture
def renewals() -> list[str]:
    return []


@pytest.fixture(autouse=True)
def fake_lock(renewals: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace the Redis merge lease, recording every renewal it is asked for."""

    @contextmanager
    def _lock(dataset_id: str) -> Generator[Callable[[], None], None, None]:
        yield lambda: renewals.append(dataset_id)

    monkeypatch.setattr(neo4j_module, "graph_index_lock", _lock)


@pytest.fixture
def store(neo_session: _FakeSession, monkeypatch: pytest.MonkeyPatch) -> Neo4jGraphStore:
    """A store whose schema already exists, so recorded calls start clean."""
    monkeypatch.setattr(neo4j_module, "_schema_ready", True)
    monkeypatch.setattr(neo4j_module, "_get_driver", lambda: _FakeDriver(neo_session))
    store = Neo4jGraphStore(_dataset())
    neo_session.calls.clear()
    return store


class TestDriver:
    def test_the_optional_neo4j_package_is_reported_as_a_missing_extra(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(neo4j_module, "_driver", None)
        # A None entry makes the import fail whether or not the optional
        # dependency group happens to be installed in this environment.
        monkeypatch.setitem(sys.modules, "neo4j", None)

        with pytest.raises(ImportError, match="graph-neo4j"):
            neo4j_module._get_driver()

    def test_the_driver_is_built_once_and_shared_across_calls(
        self, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
    ) -> None:
        built: list[tuple[str, tuple[str, str]]] = []

        class _GraphDatabase:
            @staticmethod
            def driver(uri: str, auth: tuple[str, str]) -> str:
                built.append((uri, auth))
                return "driver"

        module = ModuleType("neo4j")
        module.GraphDatabase = _GraphDatabase  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "neo4j", module)
        monkeypatch.setattr(neo4j_module, "_driver", None)
        config_overrides(
            KNOWLEDGE_GRAPH_NEO4J_URI="bolt://graph:7687",
            KNOWLEDGE_GRAPH_NEO4J_USER="neo4j",
            KNOWLEDGE_GRAPH_NEO4J_PASSWORD="secret",
        )

        assert neo4j_module._get_driver() == "driver"
        assert neo4j_module._get_driver() == "driver"

        # Retrieval builds a store per query; reconnecting each time would throw
        # away the driver's connection pool.
        assert built == [("bolt://graph:7687", ("neo4j", "secret"))]

    def test_a_driver_built_while_we_waited_for_the_lock_is_reused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(neo4j_module, "_driver", None)

        @contextmanager
        def _lock_won_by_another_thread() -> Generator[None, None, None]:
            # Whoever held the lock finished connecting while we queued behind
            # them; without the second check we would connect all over again.
            neo4j_module._driver = "driver built elsewhere"
            yield

        monkeypatch.setattr(neo4j_module, "_driver_lock", _lock_won_by_another_thread())

        assert neo4j_module._get_driver() == "driver built elsewhere"


class TestSchema:
    @pytest.mark.usefixtures("driver")
    def test_constraints_and_indexes_are_created_on_first_use(
        self, neo_session: _FakeSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(neo4j_module, "_schema_ready", False)

        Neo4jGraphStore(_dataset())

        assert len(neo_session.queries_matching("IF NOT EXISTS")) == len(neo4j_module._SCHEMA_STATEMENTS)

    @pytest.mark.usefixtures("driver")
    def test_the_schema_is_not_recreated_for_every_store(
        self, neo_session: _FakeSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(neo4j_module, "_schema_ready", False)

        Neo4jGraphStore(_dataset())
        neo_session.calls.clear()
        Neo4jGraphStore(_dataset())

        # Constraints are global to the database and a store is constructed per
        # query, so re-issuing the DDL would cost round-trips on every retrieval.
        assert neo_session.calls == []

    @pytest.mark.usefixtures("driver")
    def test_a_schema_created_while_we_waited_for_the_lock_is_not_recreated(
        self, neo_session: _FakeSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(neo4j_module, "_schema_ready", False)

        @contextmanager
        def _lock_won_by_another_thread() -> Generator[None, None, None]:
            # The thread ahead of us in the queue already ran the DDL.
            neo4j_module._schema_ready = True
            yield

        monkeypatch.setattr(neo4j_module, "_schema_lock", _lock_won_by_another_thread())

        Neo4jGraphStore(_dataset())

        assert neo_session.calls == []

    def test_the_configured_database_is_used(
        self,
        driver: _FakeDriver,
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        session: Session,
    ) -> None:
        monkeypatch.setattr(neo4j_module, "_schema_ready", True)
        config_overrides(KNOWLEDGE_GRAPH_NEO4J_DATABASE="knowledge")

        Neo4jGraphStore(_dataset()).delete(session=session)

        assert driver.databases == ["knowledge"]


class TestAddChunkGraphs:
    def test_nothing_is_written_for_an_empty_batch(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.add_chunk_graphs([], session=session)

        assert neo_session.calls == []

    def test_entities_relations_and_provenance_are_merged_in_one_transaction(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        chunk = _chunk_graph(
            "node-1",
            "doc-1",
            [_entity("acme"), _entity("globex")],
            [GraphRelation(source="acme", target="globex", predicate="acquired")],
        )

        store.add_chunk_graphs([chunk], session=session)

        # A half-written subgraph is worse than none: entities, edges and
        # provenance land together or not at all.
        assert neo_session.write_transactions == 1
        _, entity_params = neo_session.queries_matching("MERGE (e:DifyEntity")[0]
        assert [row["name"] for row in _merged_rows(entity_params)] == ["acme", "globex"]
        assert entity_params["dataset_id"] == DATASET_ID
        assert entity_params["tenant_id"] == TENANT_ID
        _, relation_params = neo_session.queries_matching("MERGE (s)-[r:DIFY_RELATION")[0]
        assert relation_params["rows"] == [
            {
                "source": "acme",
                "target": "globex",
                "predicate": "acquired",
                "description": "",
                "index_node_id": "node-1",
                "document_id": "doc-1",
            }
        ]

    def test_reindexing_a_chunk_replaces_its_provenance_before_merging(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme")])], session=session)

        _, params = neo_session.queries_matching("DETACH DELETE c")[0]
        assert params["chunk_ids"] == ["node-1"]
        # Merging on top of the old links would double-count the chunk in both
        # frequency and weight.
        assert neo_session.index_of("DETACH DELETE c") < neo_session.index_of("MERGE (e:DifyEntity")

    def test_the_merge_lease_is_renewed_before_the_write(
        self, store: Neo4jGraphStore, session: Session, renewals: list[str]
    ) -> None:
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme")])], session=session)

        assert renewals == [DATASET_ID]

    def test_counters_are_recomputed_only_for_the_facts_this_merge_touched(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.add_chunk_graphs(
            [
                _chunk_graph(
                    "node-1",
                    "doc-1",
                    [_entity("globex"), _entity("acme")],
                    [GraphRelation(source="acme", target="globex", predicate="acquired")],
                )
            ],
            session=session,
        )

        frequency_query, frequency_params = neo_session.queries_matching("SET e.frequency = mentions")[0]
        assert frequency_query.startswith("UNWIND $names")
        # Sorted and deduplicated so concurrent merges lock rows in one order.
        assert frequency_params["names"] == ["acme", "globex"]
        weight_query, _ = neo_session.queries_matching("SET r.weight = toFloat(supported)")[0]
        assert weight_query.startswith("UNWIND $rows")

    def test_a_chunk_without_relations_skips_the_relation_statements(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme")])], session=session)

        assert neo_session.queries_matching("MERGE (s)-[r:DIFY_RELATION") == []
        assert neo_session.queries_matching("SET r.weight = toFloat(supported)") == []

    def test_a_chunk_without_entities_skips_the_entity_statements(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.add_chunk_graphs(
            [
                _chunk_graph(
                    "node-1",
                    "doc-1",
                    relations=[GraphRelation(source="acme", target="globex", predicate="acquired")],
                )
            ],
            session=session,
        )

        assert neo_session.queries_matching("MERGE (e:DifyEntity") == []
        assert neo_session.queries_matching("SET e.frequency = mentions") == []

    def test_an_entity_missing_its_optional_fields_still_merges(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        chunk = _chunk_graph("node-1", "doc-1", [GraphEntity(name="acme", display_name="")])

        store.add_chunk_graphs([chunk], session=session)

        row = _merged_rows(neo_session.queries_matching("MERGE (e:DifyEntity")[0][1])[0]
        assert row["display_name"] == "acme"
        assert row["entity_type"] == UNKNOWN_ENTITY_TYPE


class TestDelete:
    def test_deleting_no_documents_touches_nothing(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.delete_by_document_ids([], session=session)

        assert neo_session.calls == []

    def test_deleting_no_chunks_touches_nothing(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.delete_by_index_node_ids([], session=session)

        assert neo_session.calls == []

    def test_deleting_documents_removes_their_chunks_under_the_lease(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session, renewals: list[str]
    ) -> None:
        store.delete_by_document_ids(["doc-1"], session=session)

        _, params = neo_session.queries_matching("c.document_id IN $ids")[0]
        assert params == {"dataset_id": DATASET_ID, "ids": ["doc-1"]}
        assert neo_session.write_transactions == 1
        assert renewals == [DATASET_ID]

    def test_deleting_chunks_removes_them_by_index_node_id(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.delete_by_index_node_ids(["node-1", "node-2"], session=session)

        _, params = neo_session.queries_matching("c.index_node_id IN $ids")[0]
        assert params["ids"] == ["node-1", "node-2"]

    def test_relations_are_pruned_before_the_entities_they_connect(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.delete_by_document_ids(["doc-1"], session=session)

        # Detaching an entity takes its edges with it, so pruning edges last
        # would leave a deleted fact bridging two entities that survived.
        assert neo_session.index_of("WHERE supported = 0 DELETE r") < neo_session.index_of(
            "WHERE NOT (e)-[:MENTIONED_IN]->(:DifyChunk) DETACH DELETE e"
        )

    def test_pruning_recomputes_every_counter_in_the_dataset(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.delete_by_document_ids(["doc-1"], session=session)

        # Whatever survived lost some of its support, so the scoped recompute a
        # merge can get away with is not enough here.
        frequency_query, frequency_params = neo_session.queries_matching("SET e.frequency = mentions")[0]
        assert "UNWIND" not in frequency_query
        assert frequency_params == {"dataset_id": DATASET_ID}
        weight_query, _ = neo_session.queries_matching("SET r.weight = toFloat(supported)")[0]
        assert "UNWIND" not in weight_query

    def test_dropping_the_graph_only_touches_this_dataset(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.delete(session=session)

        # One Neo4j instance serves every knowledge base in the deployment.
        query, params = neo_session.calls[0]
        assert "n.dataset_id = $dataset_id" in query
        assert params == {"dataset_id": DATASET_ID}


class TestEntityLookups:
    def test_looking_up_no_names_skips_the_query(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        assert store.get_entities_by_names([], session=session) == []
        assert neo_session.calls == []

    def test_stored_nodes_are_mapped_onto_the_shared_entity_model(
        self, install_driver: Callable[[_FakeSession], _FakeDriver], session: Session
    ) -> None:
        node = {
            "id": "entity-1",
            "name": "acme",
            "display_name": "Acme",
            "entity_type": "ORGANIZATION",
            "description": "a manufacturer",
            "frequency": 3,
        }
        install_driver(_FakeSession({"e.name IN $names": [{"e": node}]}))

        entities = Neo4jGraphStore(_dataset()).get_entities_by_names(["acme"], session=session)

        assert len(entities) == 1
        assert entities[0].id == "entity-1"
        assert entities[0].display_name == "Acme"
        assert entities[0].frequency == 3

    def test_a_node_missing_its_optional_properties_still_maps(
        self, install_driver: Callable[[_FakeSession], _FakeDriver], session: Session
    ) -> None:
        install_driver(_FakeSession({"e.name IN $names": [{"e": {"id": "entity-1", "name": "acme"}}]}))

        entity = Neo4jGraphStore(_dataset()).get_entities_by_names(["acme"], session=session)[0]

        # The display name falls back to the canonical one so the console never
        # renders a blank node.
        assert entity.display_name == "acme"
        assert entity.entity_type == UNKNOWN_ENTITY_TYPE
        assert entity.description == ""
        assert entity.frequency == 1

    def test_a_document_filter_restricts_lookups_to_mentioning_chunks(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.get_entities_by_names(["acme"], session=session, document_ids=["doc-1"])

        query, params = neo_session.calls[0]
        # Without this an excluded document could still seed retrieval.
        assert "MENTIONED_IN" in query
        assert params["document_ids"] == ["doc-1"]

    def test_without_a_document_filter_no_provenance_clause_is_added(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.get_entities_by_names(["acme"], session=session)

        assert "MENTIONED_IN" not in neo_session.calls[0][0]

    def test_blank_keywords_never_reach_the_database(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        # `CONTAINS ''` matches every entity in the dataset.
        assert store.search_entities(["  ", ""], 10, session=session) == []
        assert neo_session.calls == []

    def test_searching_trims_keywords_and_bounds_the_result(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.search_entities([" acme ", ""], 5, session=session, document_ids=["doc-1"])

        query, params = neo_session.calls[0]
        assert params["keywords"] == ["acme"]
        assert params["limit"] == 5
        assert "ORDER BY e.frequency DESC" in query
        assert "MENTIONED_IN" in query

    def test_looking_up_no_ids_skips_the_query(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        assert store.get_entities_by_ids([], session=session) == []
        assert neo_session.calls == []

    def test_entities_are_fetched_by_id_for_far_edge_endpoints(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.get_entities_by_ids(["entity-1"], session=session)

        query, params = neo_session.calls[0]
        assert "e.id IN $ids" in query
        assert params["ids"] == ["entity-1"]

    def test_listing_returns_the_most_mentioned_entities_first(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.list_entities(20, session=session)

        query, params = neo_session.calls[0]
        assert "ORDER BY e.frequency DESC" in query
        assert params["limit"] == 20


class TestGetRelations:
    def test_no_entities_means_no_edges(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        assert store.get_relations([], 10, session=session) == []
        assert neo_session.calls == []

    def test_edges_are_returned_in_either_direction_with_their_endpoints(
        self, install_driver: Callable[[_FakeSession], _FakeDriver], session: Session
    ) -> None:
        record: dict[str, object] = {
            "r": {"id": "relation-1", "predicate": "acquired", "description": "Acme bought Globex", "weight": 2.0},
            "source_id": "entity-1",
            "target_id": "entity-2",
        }
        neo_session = _FakeSession({"DIFY_RELATION": [record]})
        install_driver(neo_session)

        relations = Neo4jGraphStore(_dataset()).get_relations(["entity-1"], 10, session=session)

        assert len(relations) == 1
        assert relations[0].source_entity_id == "entity-1"
        assert relations[0].target_entity_id == "entity-2"
        assert relations[0].weight == 2.0
        # A seed is as likely to be the target of a fact as its source.
        assert "s.id IN $ids OR t.id IN $ids" in neo_session.calls[0][0]

    def test_an_edge_missing_its_properties_falls_back_to_defaults(
        self, install_driver: Callable[[_FakeSession], _FakeDriver], session: Session
    ) -> None:
        record: dict[str, object] = {"r": {}, "source_id": "entity-1", "target_id": "entity-2"}
        install_driver(_FakeSession({"DIFY_RELATION": [record]}))

        relation = Neo4jGraphStore(_dataset()).get_relations(["entity-1"], 10, session=session)[0]

        assert relation.predicate == "related_to"
        assert relation.weight == 1.0
        assert relation.description == ""

    def test_a_document_filter_keeps_out_edges_no_allowed_chunk_supports(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.get_relations(["entity-1"], 10, session=session, document_ids=["doc-1"])

        query, params = neo_session.calls[0]
        # Endpoints inside the filter are not enough: the fact itself has to
        # come from a chunk of an allowed document.
        assert "sup.relation_id = r.id" in query
        assert params["document_ids"] == ["doc-1"]

    def test_without_a_document_filter_no_support_clause_is_added(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.get_relations(["entity-1"], 10, session=session)

        assert "sup.relation_id = r.id" not in neo_session.calls[0][0]


class TestGetChunkLinks:
    def test_no_ids_means_no_queries(self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session) -> None:
        assert store.get_chunk_links([], [], session=session) == []
        assert neo_session.calls == []

    def test_entity_provenance_is_returned(
        self, install_driver: Callable[[_FakeSession], _FakeDriver], session: Session
    ) -> None:
        install_driver(
            _FakeSession(
                {"MENTIONED_IN": [{"entity_id": "entity-1", "index_node_id": "node-1", "document_id": "doc-1"}]}
            )
        )

        links = Neo4jGraphStore(_dataset()).get_chunk_links(["entity-1"], [], session=session)

        assert len(links) == 1
        assert links[0].index_node_id == "node-1"
        assert links[0].entity_id == "entity-1"
        assert links[0].relation_id is None

    def test_relation_provenance_is_returned(
        self, install_driver: Callable[[_FakeSession], _FakeDriver], session: Session
    ) -> None:
        install_driver(
            _FakeSession(
                {"SUPPORTS": [{"relation_id": "relation-1", "index_node_id": "node-2", "document_id": "doc-1"}]}
            )
        )

        links = Neo4jGraphStore(_dataset()).get_chunk_links([], ["relation-1"], session=session)

        # Every retrieved fact has to resolve to a citable chunk, edges included.
        assert len(links) == 1
        assert links[0].relation_id == "relation-1"
        assert links[0].entity_id is None

    def test_both_kinds_of_provenance_are_collected_in_one_session(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.get_chunk_links(["entity-1"], ["relation-1"], session=session)

        assert len(neo_session.queries_matching("MENTIONED_IN")) == 1
        assert len(neo_session.queries_matching("SUPPORTS")) == 1

    def test_a_document_filter_narrows_both_queries(
        self, store: Neo4jGraphStore, neo_session: _FakeSession, session: Session
    ) -> None:
        store.get_chunk_links(["entity-1"], ["relation-1"], session=session, document_ids=["doc-1"])

        assert len(neo_session.calls) == 2
        for query, params in neo_session.calls:
            assert "c.document_id IN $document_ids" in query
            assert params["document_ids"] == ["doc-1"]


class TestStats:
    def test_counts_and_the_type_histogram_are_reported(
        self, install_driver: Callable[[_FakeSession], _FakeDriver], session: Session
    ) -> None:
        install_driver(
            _FakeSession(
                {
                    "RETURN count(e) AS c": [{"c": 7}],
                    "RETURN count(r) AS c": [{"c": 4}],
                    "RETURN e.entity_type AS entity_type": [
                        {"entity_type": "ORGANIZATION", "c": 5},
                        {"entity_type": "PERSON", "c": 2},
                    ],
                }
            )
        )

        stats = Neo4jGraphStore(_dataset()).stats(session=session)

        assert stats.entity_count == 7
        assert stats.relation_count == 4
        assert stats.entity_types == {"ORGANIZATION": 5, "PERSON": 2}

    def test_a_dataset_without_a_graph_reports_zeros(self, store: Neo4jGraphStore, session: Session) -> None:
        # `single()` returns nothing on an empty match, and the console asks for
        # stats before anything has been indexed.
        stats = store.stats(session=session)

        assert stats.entity_count == 0
        assert stats.relation_count == 0
        assert stats.entity_types == {}
