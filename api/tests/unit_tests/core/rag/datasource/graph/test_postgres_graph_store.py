import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.graph.postgres.postgres_graph_store import PostgresGraphStore
from core.rag.graph.entities import ChunkGraph, GraphEntity, GraphExtraction, GraphRelation
from models.dataset import Dataset, DatasetGraphChunkLink, DatasetGraphEntity, DatasetGraphRelation

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


def _entity(name: str, entity_type: str = "ORGANIZATION", description: str = "") -> GraphEntity:
    return GraphEntity(name=name, display_name=name.title(), entity_type=entity_type, description=description)


def _chunk_graph(
    index_node_id: str,
    document_id: str,
    entities: list[GraphEntity],
    relations: list[GraphRelation] | None = None,
) -> ChunkGraph:
    return ChunkGraph(
        index_node_id=index_node_id,
        document_id=document_id,
        extraction=GraphExtraction(entities=entities, relations=relations or []),
    )


@pytest.fixture
def store() -> PostgresGraphStore:
    return PostgresGraphStore(_dataset())


@pytest.fixture
def session(sqlite_session_factory: sessionmaker[Session]):
    with sqlite_session_factory() as session:
        yield session


def _count(session: Session, model) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


class TestAddChunkGraphs:
    def test_persists_entities_relations_and_links(self, store: PostgresGraphStore, session: Session):
        chunk = _chunk_graph(
            "node-1",
            "doc-1",
            [_entity("acme"), _entity("globex")],
            [GraphRelation(source="acme", target="globex", predicate="acquired")],
        )

        store.add_chunk_graphs([chunk], session=session)

        assert _count(session, DatasetGraphEntity) == 2
        assert _count(session, DatasetGraphRelation) == 1
        # One link per entity plus one for the relation.
        assert _count(session, DatasetGraphChunkLink) == 3

    def test_entity_seen_in_two_chunks_merges_into_one_row(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs(
            [
                _chunk_graph("node-1", "doc-1", [_entity("acme", description="first")]),
                _chunk_graph("node-2", "doc-1", [_entity("acme", description="second")]),
            ],
            session=session,
        )

        entities = session.scalars(select(DatasetGraphEntity)).all()
        assert len(entities) == 1
        assert entities[0].frequency == 2
        # Both descriptions are retained so retrieval sees the merged view.
        assert "first" in (entities[0].description or "")
        assert "second" in (entities[0].description or "")

    def test_repeated_relation_accumulates_weight(self, store: PostgresGraphStore, session: Session):
        relation = GraphRelation(source="acme", target="globex", predicate="acquired")
        entities = [_entity("acme"), _entity("globex")]
        store.add_chunk_graphs(
            [
                _chunk_graph("node-1", "doc-1", entities, [relation]),
                _chunk_graph("node-2", "doc-1", entities, [relation]),
            ],
            session=session,
        )

        rows = session.scalars(select(DatasetGraphRelation)).all()
        assert len(rows) == 1
        assert rows[0].weight == 2.0

    def test_reindexing_a_chunk_replaces_its_links(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme")])], session=session)
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme")])], session=session)

        assert _count(session, DatasetGraphChunkLink) == 1

    def test_unknown_type_is_upgraded_when_a_later_chunk_types_the_entity(
        self, store: PostgresGraphStore, session: Session
    ):
        store.add_chunk_graphs(
            [_chunk_graph("node-1", "doc-1", [_entity("acme", entity_type="UNKNOWN")])], session=session
        )
        store.add_chunk_graphs(
            [_chunk_graph("node-2", "doc-1", [_entity("acme", entity_type="ORGANIZATION")])], session=session
        )

        entity = session.scalars(select(DatasetGraphEntity)).one()
        assert entity.entity_type == "ORGANIZATION"

    def test_relation_with_unresolvable_endpoint_is_skipped(self, store: PostgresGraphStore, session: Session):
        chunk = _chunk_graph(
            "node-1",
            "doc-1",
            [_entity("acme")],
            [GraphRelation(source="acme", target="never-extracted", predicate="acquired")],
        )

        store.add_chunk_graphs([chunk], session=session)

        assert _count(session, DatasetGraphRelation) == 0

    def test_empty_input_is_a_no_op(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs([], session=session)

        assert _count(session, DatasetGraphEntity) == 0


class TestDeletion:
    def test_deleting_a_document_prunes_its_orphaned_facts(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs(
            [
                _chunk_graph(
                    "node-1",
                    "doc-1",
                    [_entity("acme"), _entity("globex")],
                    [GraphRelation(source="acme", target="globex", predicate="acquired")],
                )
            ],
            session=session,
        )

        store.delete_by_document_ids(["doc-1"], session=session)

        assert _count(session, DatasetGraphEntity) == 0
        assert _count(session, DatasetGraphRelation) == 0
        assert _count(session, DatasetGraphChunkLink) == 0

    def test_entities_still_supported_by_another_document_survive(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme")])], session=session)
        store.add_chunk_graphs([_chunk_graph("node-2", "doc-2", [_entity("acme")])], session=session)

        store.delete_by_document_ids(["doc-1"], session=session)

        entity = session.scalars(select(DatasetGraphEntity)).one()
        assert entity.name == "acme"
        assert _count(session, DatasetGraphChunkLink) == 1

    def test_edges_are_dropped_when_an_endpoint_is_pruned(self, store: PostgresGraphStore, session: Session):
        # doc-1 supports both entities and the edge; doc-2 only re-mentions acme.
        store.add_chunk_graphs(
            [
                _chunk_graph(
                    "node-1",
                    "doc-1",
                    [_entity("acme"), _entity("globex")],
                    [GraphRelation(source="acme", target="globex", predicate="acquired")],
                )
            ],
            session=session,
        )
        store.add_chunk_graphs([_chunk_graph("node-2", "doc-2", [_entity("acme")])], session=session)

        store.delete_by_document_ids(["doc-1"], session=session)

        assert [entity.name for entity in session.scalars(select(DatasetGraphEntity)).all()] == ["acme"]
        assert _count(session, DatasetGraphRelation) == 0

    def test_delete_by_index_node_ids(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme")])], session=session)

        store.delete_by_index_node_ids(["node-1"], session=session)

        assert _count(session, DatasetGraphEntity) == 0

    def test_delete_drops_the_whole_graph(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs(
            [
                _chunk_graph(
                    "node-1",
                    "doc-1",
                    [_entity("acme"), _entity("globex")],
                    [GraphRelation(source="acme", target="globex", predicate="acquired")],
                )
            ],
            session=session,
        )

        store.delete(session=session)

        assert _count(session, DatasetGraphEntity) == 0
        assert _count(session, DatasetGraphRelation) == 0
        assert _count(session, DatasetGraphChunkLink) == 0


class TestQueries:
    def test_search_entities_matches_a_name_fragment(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs(
            [_chunk_graph("node-1", "doc-1", [_entity("acme corporation"), _entity("globex")])],
            session=session,
        )

        results = store.search_entities(["acme"], 10, session=session)

        assert [entity.name for entity in results] == ["acme corporation"]

    def test_search_entities_orders_by_frequency(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme one")])], session=session)
        store.add_chunk_graphs(
            [
                _chunk_graph("node-2", "doc-1", [_entity("acme two")]),
                _chunk_graph("node-3", "doc-1", [_entity("acme two")]),
            ],
            session=session,
        )

        results = store.search_entities(["acme"], 10, session=session)

        assert [entity.name for entity in results] == ["acme two", "acme one"]

    def test_search_entities_treats_wildcards_literally(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme")])], session=session)

        # A bare "%" must not behave as "match everything".
        assert store.search_entities(["%"], 10, session=session) == []

    def test_search_entities_ignores_blank_keywords(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme")])], session=session)

        assert store.search_entities(["", "  "], 10, session=session) == []

    def test_get_relations_walks_both_directions(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs(
            [
                _chunk_graph(
                    "node-1",
                    "doc-1",
                    [_entity("acme"), _entity("globex")],
                    [GraphRelation(source="acme", target="globex", predicate="acquired")],
                )
            ],
            session=session,
        )
        target = session.scalars(select(DatasetGraphEntity).where(DatasetGraphEntity.name == "globex")).one()

        # Seeded from the *target*, the inbound edge must still be found.
        relations = store.get_relations([target.id], 10, session=session)

        assert [relation.predicate for relation in relations] == ["acquired"]

    def test_list_entities_returns_most_frequent_first(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("rare")])], session=session)
        store.add_chunk_graphs(
            [
                _chunk_graph("node-2", "doc-1", [_entity("common")]),
                _chunk_graph("node-3", "doc-1", [_entity("common")]),
            ],
            session=session,
        )

        results = store.list_entities(10, session=session)

        assert [entity.name for entity in results] == ["common", "rare"]

    def test_stats_reports_counts_by_type(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs(
            [
                _chunk_graph(
                    "node-1",
                    "doc-1",
                    [_entity("acme", entity_type="ORGANIZATION"), _entity("jane", entity_type="PERSON")],
                    [GraphRelation(source="jane", target="acme", predicate="leads")],
                )
            ],
            session=session,
        )

        stats = store.stats(session=session)

        assert stats.entity_count == 2
        assert stats.relation_count == 1
        assert stats.entity_types == {"ORGANIZATION": 1, "PERSON": 1}

    def test_get_chunk_links_resolves_provenance(self, store: PostgresGraphStore, session: Session):
        store.add_chunk_graphs([_chunk_graph("node-1", "doc-1", [_entity("acme")])], session=session)
        entity = session.scalars(select(DatasetGraphEntity)).one()

        links = store.get_chunk_links([entity.id], [], session=session)

        assert [link.index_node_id for link in links] == ["node-1"]
        assert links[0].document_id == "doc-1"
