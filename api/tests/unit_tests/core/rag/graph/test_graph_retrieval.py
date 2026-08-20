import sys
import types
from collections.abc import Callable, Iterator

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.graph.postgres.postgres_graph_store import PostgresGraphStore
from core.rag.datasource.keyword.jieba import jieba_keyword_table_handler as jieba_handler_module
from core.rag.graph import graph_retrieval as graph_retrieval_module
from core.rag.graph.entities import ChunkGraph, GraphEntity, GraphExtraction, GraphRelation
from core.rag.graph.graph_retrieval import GraphRetrieval, extract_query_keywords
from models.dataset import Dataset, DocumentSegment
from models.enums import SegmentStatus

DATASET_ID = "dataset-1"
TENANT_ID = "tenant-1"


def _dataset(**setting_overrides: bool | int | float) -> Dataset:
    setting = {"enabled": True, "max_depth": 2, "hop_decay": 0.5, "max_seed_entities": 8}
    setting.update(setting_overrides)
    return Dataset(
        id=DATASET_ID,
        tenant_id=TENANT_ID,
        name="kb",
        created_by="user-1",
        graph_index_setting=setting,
    )


def _entity(name: str) -> GraphEntity:
    return GraphEntity(name=name, display_name=name.title(), entity_type="ORGANIZATION")


def _segment(session: Session, index_node_id: str, document_id: str, content: str, enabled: bool = True) -> None:
    segment = DocumentSegment(
        tenant_id=TENANT_ID,
        dataset_id=DATASET_ID,
        document_id=document_id,
        position=0,
        content=content,
        word_count=len(content.split()),
        tokens=len(content.split()),
        created_by="user-1",
        index_node_id=index_node_id,
        enabled=enabled,
        status=SegmentStatus.COMPLETED,
    )
    session.add(segment)
    session.flush()


@pytest.fixture
def session(sqlite_session_factory: sessionmaker[Session]) -> Iterator[Session]:
    with sqlite_session_factory() as session:
        yield session


@pytest.fixture
def seed_keywords(monkeypatch: pytest.MonkeyPatch) -> Callable[[list[str]], None]:
    """Pin query tokenization so tests exercise traversal, not the tokenizer."""

    def _install(keywords: list[str]) -> None:
        monkeypatch.setattr(graph_retrieval_module, "extract_query_keywords", lambda _query: keywords)

    return _install


def _link(index_node_id: str, document_id: str, source: str, target: str, predicate: str) -> ChunkGraph:
    return ChunkGraph(
        index_node_id=index_node_id,
        document_id=document_id,
        extraction=GraphExtraction(
            entities=[_entity(source), _entity(target)],
            relations=[GraphRelation(source=source, target=target, predicate=predicate)],
        ),
    )


def _build_chain_graph(session: Session, dataset: Dataset) -> None:
    """acme -> globex -> initech -> umbrella, each link in its own chunk/document.

    This is the shape vector search handles badly: nothing in doc-3 mentions
    Acme, so only a multi-hop walk connects a question about Acme to it.

    Note each chunk shares its near endpoint with the previous chunk, so doc-2
    is reachable in one hop (it mentions Globex) while doc-3 needs two.
    """
    store = PostgresGraphStore(dataset)
    store.add_chunk_graphs(
        [
            _link("node-1", "doc-1", "acme", "globex", "acquired"),
            _link("node-2", "doc-2", "globex", "initech", "owns"),
            _link("node-3", "doc-3", "initech", "umbrella", "operates"),
        ],
        session=session,
    )
    _segment(session, "node-1", "doc-1", "Acme acquired Globex.")
    _segment(session, "node-2", "doc-2", "Globex owns Initech.")
    _segment(session, "node-3", "doc-3", "Initech operates Umbrella.")


class _StubKeywordHandler:
    """Deterministic stand-in for the jieba-backed keyword handler.

    Splits on whitespace instead of running TF-IDF, so these tests assert on the
    normalization `extract_query_keywords` applies rather than on jieba's
    tokenization, which is not under test here.
    """

    def extract_keywords(self, text: str, max_keywords_per_chunk: int | None = 10) -> set[str]:
        return set(text.split()[: max_keywords_per_chunk or None])


@pytest.fixture
def stub_tokenizer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jieba_handler_module, "JiebaKeywordTableHandler", _StubKeywordHandler)


@pytest.mark.usefixtures("stub_tokenizer")
class TestExtractQueryKeywords:
    def test_keywords_are_casefolded_for_entity_lookup(self) -> None:
        # Entity names are stored casefolded, so probes must be too.
        keywords = extract_query_keywords("Who leads ACME Corporation?")

        assert "acme" in keywords
        assert "corporation" in keywords

    def test_punctuation_is_stripped_from_tokens(self) -> None:
        assert extract_query_keywords('"Acme."') == ["acme"]

    def test_single_character_tokens_are_dropped(self) -> None:
        # One-character fragments match nearly every entity name.
        assert extract_query_keywords("a b acme") == ["acme"]

    def test_duplicate_tokens_are_deduplicated(self) -> None:
        assert extract_query_keywords("Acme acme ACME") == ["acme"]

    def test_empty_query_yields_no_keywords(self) -> None:
        assert extract_query_keywords("") == []

    def test_tokenizer_failure_falls_back_to_whitespace_split(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # A broken tokenizer must degrade to a usable probe, not kill retrieval.
        broken = types.ModuleType("jieba")
        broken.__path__ = []  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "jieba", broken)
        monkeypatch.delitem(sys.modules, "jieba.analyse", raising=False)

        # Order is not meaningful: the keywords are OR'd into one lookup.
        assert set(extract_query_keywords("acme globex")) == {"acme", "globex"}


class TestRetrieve:
    def test_reaches_a_distant_chunk_the_query_never_mentions(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=10, session=session)

        node_ids = {document.metadata["doc_id"] for document in documents}
        # node-3 mentions neither "Acme" nor anything else in the query; only
        # the two-hop walk connects it.
        assert node_ids == {"node-1", "node-2", "node-3"}

    def test_closer_facts_outrank_distant_ones(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=10, session=session)

        assert [document.metadata["doc_id"] for document in documents] == ["node-1", "node-2", "node-3"]
        scores = [document.metadata["score"] for document in documents]
        assert scores[0] > scores[1] > scores[2]

    def test_depth_limit_stops_the_walk(self, session: Session, seed_keywords: Callable[[list[str]], None]) -> None:
        dataset = _dataset(max_depth=1)
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=10, session=session)

        # One hop reaches Globex, and so the chunk that mentions it, but Initech
        # and the chunk beyond it stay out of range.
        assert {document.metadata["doc_id"] for document in documents} == {"node-1", "node-2"}

    def test_results_carry_citation_metadata(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=10, session=session)

        metadata = documents[0].metadata
        # These are the fields the citation pipeline resolves a segment from.
        assert metadata["dataset_id"] == DATASET_ID
        assert metadata["document_id"] == "doc-1"
        assert metadata["doc_id"] == "node-1"
        assert documents[0].page_content == "Acme acquired Globex."

    def test_results_explain_the_path_walked(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=10, session=session)
        second_hop = next(d for d in documents if d.metadata["doc_id"] == "node-3")

        path = second_hop.metadata["graph_path"]
        assert path["hop"] == 2
        assert path["seed_entity"] == "Acme"
        # The full walk is reported so the answer can be justified to the user.
        assert path["relations"] == ["Acme -[acquired]-> Globex", "Globex -[owns]-> Initech"]
        assert path["entities"] == ["Acme", "Globex", "Initech"]

    def test_top_k_is_respected(self, session: Session, seed_keywords: Callable[[list[str]], None]) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=1, session=session)

        assert len(documents) == 1

    def test_disabled_segments_are_never_returned(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        segment = session.query(DocumentSegment).filter_by(index_node_id="node-2").one()
        segment.enabled = False
        session.flush()
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=10, session=session)

        # node-2 is dropped even though its facts are still in the graph; the
        # rest of the walk is unaffected.
        assert {document.metadata["doc_id"] for document in documents} == {"node-1", "node-3"}

    def test_document_ids_filter_is_applied(self, session: Session, seed_keywords: Callable[[list[str]], None]) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(
            dataset, "What does Acme own?", top_k=10, session=session, document_ids_filter=["doc-2"]
        )

        assert {document.metadata["doc_id"] for document in documents} == {"node-2"}

    def test_scores_are_normalized_to_at_most_one(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=10, session=session)

        assert all(0 < document.metadata["score"] <= 1.0 for document in documents)

    def test_returns_nothing_when_no_entity_matches(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["nonexistent"])

        assert GraphRetrieval.retrieve(dataset, "Unrelated question?", top_k=10, session=session) == []

    def test_returns_nothing_when_the_graph_is_disabled(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset(enabled=False)
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        assert GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=10, session=session) == []

    def test_returns_nothing_for_a_blank_query(self, session: Session) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)

        assert GraphRetrieval.retrieve(dataset, "   ", top_k=10, session=session) == []

    def test_dataset_without_graph_setting_is_skipped(self, session: Session) -> None:
        dataset = Dataset(id=DATASET_ID, tenant_id=TENANT_ID, name="kb", created_by="user-1")

        assert GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=10, session=session) == []

    def test_walk_terminates_on_a_cyclic_graph(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        # A cycle must not loop forever or double-count a chunk.
        dataset = _dataset(max_depth=4)
        store = PostgresGraphStore(dataset)
        store.add_chunk_graphs(
            [
                ChunkGraph(
                    index_node_id="node-1",
                    document_id="doc-1",
                    extraction=GraphExtraction(
                        entities=[_entity("a"), _entity("b")],
                        relations=[
                            GraphRelation(source="a", target="b", predicate="points_to"),
                            GraphRelation(source="b", target="a", predicate="points_back"),
                        ],
                    ),
                )
            ],
            session=session,
        )
        _segment(session, "node-1", "doc-1", "A and B reference each other.")
        seed_keywords(["a"])

        documents = GraphRetrieval.retrieve(dataset, "How are A and B related?", top_k=10, session=session)

        assert [document.metadata["doc_id"] for document in documents] == ["node-1"]

    def test_chunk_supporting_more_matched_facts_ranks_higher(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset(max_depth=1)
        store = PostgresGraphStore(dataset)
        store.add_chunk_graphs(
            [
                # node-1 carries two facts about acme, node-2 only one.
                ChunkGraph(
                    index_node_id="node-1",
                    document_id="doc-1",
                    extraction=GraphExtraction(
                        entities=[_entity("acme"), _entity("globex"), _entity("initech")],
                        relations=[
                            GraphRelation(source="acme", target="globex", predicate="acquired"),
                            GraphRelation(source="acme", target="initech", predicate="funds"),
                        ],
                    ),
                ),
                ChunkGraph(
                    index_node_id="node-2",
                    document_id="doc-2",
                    extraction=GraphExtraction(
                        entities=[_entity("acme"), _entity("umbrella")],
                        relations=[GraphRelation(source="acme", target="umbrella", predicate="partners_with")],
                    ),
                ),
            ],
            session=session,
        )
        _segment(session, "node-1", "doc-1", "Acme acquired Globex and funds Initech.")
        _segment(session, "node-2", "doc-2", "Acme partners with Umbrella.")
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "Tell me about Acme", top_k=10, session=session)

        assert documents[0].metadata["doc_id"] == "node-1"
