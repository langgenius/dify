"""Lifecycle and console-exposure behaviour of :class:`GraphIndexService`."""

from collections.abc import Callable, Iterator

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.graph.postgres.postgres_graph_store import PostgresGraphStore
from core.rag.graph import graph_index_service as graph_index_service_module
from core.rag.graph import graph_retrieval as graph_retrieval_module
from core.rag.graph.entities import ChunkGraph, GraphEntity, GraphExtraction, GraphRelation
from core.rag.graph.graph_index_service import GraphIndexService
from core.rag.models.document import Document
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


_CONFIGURED: dict[str, object] = {"enabled": True, "model_provider_name": "openai", "model_name": "gpt-4o-mini"}


class _FakeExtractor:
    """Stands in for the LLM-backed extractor, recording what it was handed."""

    instances: list["_FakeExtractor"] = []

    def __init__(self, *, tenant_id: str, setting: object) -> None:
        self.tenant_id = tenant_id
        self.setting = setting
        self.documents: list[Document] = []
        self.result: list[ChunkGraph] = []
        self.error: Exception | None = None
        _FakeExtractor.instances.append(self)

    def extract_documents(self, documents: list[Document]) -> list[ChunkGraph]:
        self.documents = documents
        if self.error:
            raise self.error
        return self.result


@pytest.fixture
def extractor(monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    """Install a stand-in extractor so indexing never reaches a real model."""
    _FakeExtractor.instances.clear()

    def _install(*, result: list[ChunkGraph] | None = None, error: Exception | None = None) -> None:
        def _factory(*, tenant_id: str, setting: object) -> _FakeExtractor:
            instance = _FakeExtractor(tenant_id=tenant_id, setting=setting)
            instance.result = result or []
            instance.error = error
            return instance

        monkeypatch.setattr(graph_index_service_module, "EntityRelationExtractor", _factory)

    return _install


def _chunk_graph(index_node_id: str, document_id: str) -> ChunkGraph:
    return ChunkGraph(
        index_node_id=index_node_id,
        document_id=document_id,
        extraction=GraphExtraction(
            entities=[GraphEntity(name="acme", display_name="Acme", entity_type="ORGANIZATION")],
        ),
    )


class TestGetSetting:
    def test_a_fully_configured_dataset_yields_its_setting(self) -> None:
        setting = GraphIndexService.get_setting(_dataset(_CONFIGURED))

        assert setting is not None
        assert setting.model_name == "gpt-4o-mini"

    def test_a_dataset_without_a_setting_has_none(self) -> None:
        assert GraphIndexService.get_setting(_dataset(None)) is None

    def test_a_disabled_setting_yields_none(self) -> None:
        assert GraphIndexService.get_setting(_dataset({**_CONFIGURED, "enabled": False})) is None

    def test_an_enabled_setting_without_a_model_yields_none(self) -> None:
        # Indexing cannot run without a model; handing the setting back anyway
        # would fail one chunk at a time deep inside the extractor instead.
        assert GraphIndexService.get_setting(_dataset({"enabled": True})) is None

    def test_an_unparsable_setting_is_treated_as_off(self) -> None:
        # max_depth is bounded, and a hand-edited or migrated row can violate it.
        # That has to disable the graph, not raise through indexing.
        assert GraphIndexService.get_setting(_dataset({**_CONFIGURED, "max_depth": 99})) is None


class TestBuildForDocuments:
    def test_extracted_facts_are_merged_into_the_graph(self, session: Session, extractor: Callable[..., None]) -> None:
        extractor(result=[_chunk_graph("node-1", "doc-1")])
        documents = [Document(page_content="Acme ships widgets.", metadata={"doc_id": "node-1"})]

        GraphIndexService.build_for_documents(_dataset(_CONFIGURED), documents, session=session)

        assert _graph_row_count(session) > 0
        # Extraction runs with the dataset's own workspace credentials.
        assert _FakeExtractor.instances[0].tenant_id == TENANT_ID
        assert _FakeExtractor.instances[0].documents == documents

    def test_a_dataset_without_an_extraction_model_is_skipped(
        self, session: Session, extractor: Callable[..., None]
    ) -> None:
        extractor(result=[_chunk_graph("node-1", "doc-1")])

        GraphIndexService.build_for_documents(
            _dataset({"enabled": True}), [Document(page_content="x")], session=session
        )

        assert _FakeExtractor.instances == []
        assert _graph_row_count(session) == 0

    def test_an_empty_batch_never_reaches_the_extractor(self, session: Session, extractor: Callable[..., None]) -> None:
        extractor()

        GraphIndexService.build_for_documents(_dataset(_CONFIGURED), [], session=session)

        assert _FakeExtractor.instances == []

    def test_an_extraction_that_finds_nothing_writes_nothing(
        self, session: Session, extractor: Callable[..., None]
    ) -> None:
        extractor(result=[])

        GraphIndexService.build_for_documents(
            _dataset(_CONFIGURED), [Document(page_content="boilerplate")], session=session
        )

        assert _graph_row_count(session) == 0

    def test_an_extraction_failure_does_not_abort_indexing(
        self, session: Session, extractor: Callable[..., None]
    ) -> None:
        extractor(error=RuntimeError("the provider is down"))

        # The graph is an enhancement layer: the chunk is already searchable
        # through the vector and keyword indexes, so this must not propagate.
        GraphIndexService.build_for_documents(
            _dataset(_CONFIGURED), [Document(page_content="Acme ships widgets.")], session=session
        )

        assert _graph_row_count(session) == 0


class TestTargetedDeletion:
    def test_deleting_a_chunk_drops_the_facts_it_sourced(self, session: Session) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)

        GraphIndexService.delete_by_index_node_ids(dataset, ["node-1"], session=session)

        assert _graph_row_count(session) == 0

    def test_deleting_a_document_drops_the_facts_it_sourced(self, session: Session) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)

        GraphIndexService.delete_by_document_ids(dataset, ["doc-1"], session=session)

        assert _graph_row_count(session) == 0

    def test_deletion_is_guarded_on_the_setting_existing_not_on_it_being_on(self, session: Session) -> None:
        _seed_graph(_dataset({"enabled": True}), session)

        GraphIndexService.delete_by_index_node_ids(_dataset({"enabled": False}), ["node-1"], session=session)

        # Turning the graph off must not strand rows nothing can clean up later.
        assert _graph_row_count(session) == 0

    def test_no_chunks_means_no_work(self, session: Session) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)

        GraphIndexService.delete_by_index_node_ids(dataset, [], session=session)

        assert _graph_row_count(session) > 0

    def test_no_documents_means_no_work(self, session: Session) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)

        GraphIndexService.delete_by_document_ids(dataset, [], session=session)

        assert _graph_row_count(session) > 0

    def test_a_dataset_that_never_had_a_graph_is_skipped(self, session: Session) -> None:
        _seed_graph(_dataset({"enabled": True}), session)

        GraphIndexService.delete_by_document_ids(_dataset(None), ["doc-1"], session=session)

        assert _graph_row_count(session) > 0


class TestCleanupIsBestEffort:
    """Cleanup runs inside deletion tasks, where raising would strand the caller."""

    @pytest.fixture
    def broken_store(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class _BrokenStore:
            def __init__(self, dataset: Dataset) -> None:
                self.dataset = dataset

            def __getattr__(self, _name: str) -> Callable[..., None]:
                def _raise(*_args: object, **_kwargs: object) -> None:
                    raise RuntimeError("the graph backend is unreachable")

                return _raise

        monkeypatch.setattr(graph_index_service_module, "GraphStore", _BrokenStore)

    @pytest.mark.usefixtures("broken_store")
    def test_a_failing_backend_does_not_break_chunk_deletion(self, session: Session) -> None:
        GraphIndexService.delete_by_index_node_ids(_dataset({"enabled": True}), ["node-1"], session=session)

    @pytest.mark.usefixtures("broken_store")
    def test_a_failing_backend_does_not_break_document_deletion(self, session: Session) -> None:
        GraphIndexService.delete_by_document_ids(_dataset({"enabled": True}), ["doc-1"], session=session)

    @pytest.mark.usefixtures("broken_store")
    def test_a_failing_backend_does_not_break_delete_all(self, session: Session) -> None:
        GraphIndexService.delete_all(_dataset({"enabled": True}), session=session)

    @pytest.mark.usefixtures("broken_store")
    def test_purge_still_clears_the_metadata_tables_when_the_backend_fails(self, session: Session) -> None:
        _seed_graph(_dataset({"enabled": True}), session)

        GraphIndexService.purge_dataset(_dataset(None), session=session)

        # Whatever this deployment can still reach is gone, even though the
        # configured backend could not be asked to drop its own copy.
        assert _graph_row_count(session) == 0

    def test_purge_continues_after_one_table_fails(self, session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        _seed_graph(_dataset({"enabled": True}), session)
        real_execute = session.execute
        attempts: list[object] = []

        def _execute(statement: object, *args: object, **kwargs: object) -> object:
            attempts.append(statement)
            if len(attempts) == 1:
                raise RuntimeError("chunk-link delete failed")
            return real_execute(statement, *args, **kwargs)  # type: ignore[arg-type]

        monkeypatch.setattr(session, "execute", _execute)

        GraphIndexService.purge_dataset(_dataset(None), session=session)

        # One table failing must not leave the other two behind.
        assert len(attempts) >= 3


class TestExplore:
    def test_a_query_narrows_the_subgraph_to_matching_entities(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)
        monkeypatch.setattr(graph_retrieval_module, "extract_query_keywords", lambda _query: ["acme"])

        entities, relations = GraphIndexService.explore(dataset, "Acme", 10, session=session)

        assert "acme" in {entity.name for entity in entities}
        assert [relation.predicate for relation in relations] == ["acquired"]

    def test_the_far_endpoint_of_every_edge_is_included(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)
        monkeypatch.setattr(graph_retrieval_module, "extract_query_keywords", lambda _query: ["acme"])

        entities, relations = GraphIndexService.explore(dataset, "Acme", 10, session=session)

        # Only `acme` matched the query, but the client cannot draw the edge
        # without the node on its other end.
        returned = {entity.id for entity in entities}
        for relation in relations:
            assert relation.source_entity_id in returned
            assert relation.target_entity_id in returned

    def test_a_query_matching_nothing_returns_an_empty_subgraph(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)
        monkeypatch.setattr(graph_retrieval_module, "extract_query_keywords", lambda _query: ["nonexistent"])

        assert GraphIndexService.explore(dataset, "nonexistent", 10, session=session) == ([], [])

    def test_a_query_that_tokenizes_to_nothing_never_reaches_the_store(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)
        # An empty keyword list would otherwise become an unfiltered scan.
        monkeypatch.setattr(graph_retrieval_module, "extract_query_keywords", lambda _query: [])

        assert GraphIndexService.explore(dataset, "???", 10, session=session) == ([], [])

    def test_a_whitespace_query_falls_back_to_the_most_mentioned_entities(self, session: Session) -> None:
        dataset = _dataset({"enabled": True})
        _seed_graph(dataset, session)

        entities, _ = GraphIndexService.explore(dataset, "   ", 10, session=session)

        assert {entity.name for entity in entities} == {"acme", "globex"}

    def test_an_empty_graph_explores_to_nothing(self, session: Session) -> None:
        assert GraphIndexService.explore(_dataset({"enabled": True}), None, 10, session=session) == ([], [])
