"""Lifecycle and console-exposure behaviour of :class:`GraphIndexService`."""

from collections.abc import Iterator

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.graph.postgres.postgres_graph_store import PostgresGraphStore
from core.rag.graph.entities import ChunkGraph, GraphEntity, GraphExtraction, GraphRelation
from core.rag.graph.graph_index_service import GraphIndexService
from models.dataset import Dataset, DatasetGraphChunkLink, DatasetGraphEntity, DatasetGraphRelation

DATASET_ID = "dataset-1"
TENANT_ID = "tenant-1"


def _dataset(graph_index_setting: dict[str, object] | None) -> Dataset:
    return Dataset(
        id=DATASET_ID,
        tenant_id=TENANT_ID,
        name="kb",
        created_by="user-1",
        graph_index_setting=graph_index_setting,
    )


@pytest.fixture
def session(sqlite_session_factory: sessionmaker[Session]) -> Iterator[Session]:
    with sqlite_session_factory() as session:
        yield session


def _seed_graph(dataset: Dataset, session: Session) -> None:
    PostgresGraphStore(dataset).add_chunk_graphs(
        [
            ChunkGraph(
                index_node_id="node-1",
                document_id="doc-1",
                extraction=GraphExtraction(
                    entities=[
                        GraphEntity(name="acme", display_name="Acme", entity_type="ORGANIZATION"),
                        GraphEntity(name="globex", display_name="Globex", entity_type="ORGANIZATION"),
                    ],
                    relations=[GraphRelation(source="acme", target="globex", predicate="acquired")],
                ),
            )
        ],
        session=session,
    )


def _graph_row_count(session: Session) -> int:
    return sum(
        session.scalar(select(func.count()).select_from(model).where(model.dataset_id == DATASET_ID)) or 0
        for model in (DatasetGraphChunkLink, DatasetGraphRelation, DatasetGraphEntity)
    )


class TestConsoleExposure:
    """Turning the feature off has to turn it off everywhere, API included."""

    def test_stats_are_reported_while_enabled(self, session: Session) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)

        stats = GraphIndexService.get_stats(dataset, session=session)

        assert stats.entity_count == 2
        assert stats.relation_count == 1

    def test_stats_are_empty_once_disabled(self, session: Session) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)
        dataset.graph_index_setting = {"enabled": False}

        stats = GraphIndexService.get_stats(dataset, session=session)

        # The rows survive so re-enabling does not mean re-indexing, but the API
        # must stop serving them the moment the UI stops offering the feature.
        assert stats.entity_count == 0
        assert stats.relation_count == 0
        assert _graph_row_count(session) > 0

    def test_explore_returns_nothing_once_disabled(self, session: Session) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)
        dataset.graph_index_setting = {"enabled": False}

        assert GraphIndexService.explore(dataset, None, 10, session=session) == ([], [])

    def test_explore_returns_the_subgraph_while_enabled(self, session: Session) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)

        entities, relations = GraphIndexService.explore(dataset, None, 10, session=session)

        assert {entity.name for entity in entities} == {"acme", "globex"}
        assert [relation.predicate for relation in relations] == ["acquired"]


class TestPurge:
    def test_purge_clears_the_graph_without_a_setting(self, session: Session) -> None:
        _seed_graph(_dataset({"enabled": True}), session)

        # Dataset deletion reconstructs a bare Dataset, so the settings guards
        # the other entry points use would skip cleanup and strand every row.
        GraphIndexService.purge_dataset(_dataset(None), session=session)

        assert _graph_row_count(session) == 0

    def test_delete_all_still_respects_the_setting(self, session: Session) -> None:
        _seed_graph(_dataset({"enabled": True}), session)

        GraphIndexService.delete_all(_dataset(None), session=session)

        assert _graph_row_count(session) > 0
