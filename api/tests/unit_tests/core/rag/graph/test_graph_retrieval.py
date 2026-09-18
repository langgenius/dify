import sys
import types
from collections.abc import Callable, Iterator

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.graph.graph_base import StoredChunkLink, StoredRelation
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
            dataset, "What does Acme own?", top_k=10, session=session, document_ids_filter=["doc-1", "doc-2"]
        )

        assert {document.metadata["doc_id"] for document in documents} == {"node-1", "node-2"}

    def test_an_excluded_document_cannot_seed_the_walk(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        # Acme is only mentioned in doc-1. With the filter narrowed to doc-2 the
        # query matches nothing the caller is allowed to see, so the walk never
        # starts -- the filter is the boundary of the graph, not a sieve applied
        # to whatever the walk happened to reach.
        documents = GraphRetrieval.retrieve(
            dataset, "What does Acme own?", top_k=10, session=session, document_ids_filter=["doc-2"]
        )

        assert documents == []

    def test_an_excluded_document_cannot_bridge_a_multi_hop_path(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        # Only doc-2 knows that Globex owns Initech, so with doc-2 excluded the
        # walk must stop at Globex instead of stepping over it into doc-3.
        documents = GraphRetrieval.retrieve(
            dataset, "What does Acme own?", top_k=10, session=session, document_ids_filter=["doc-1", "doc-3"]
        )

        assert {document.metadata["doc_id"] for document in documents} == {"node-1"}

    def test_graph_path_never_names_an_excluded_document(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(
            dataset, "What does Acme own?", top_k=10, session=session, document_ids_filter=["doc-1", "doc-2"]
        )

        # The explanation is user-visible, so it must not leak entity names or
        # predicates that only appear in a document the caller filtered out.
        walked = {
            value
            for document in documents
            for value in document.metadata["graph_path"]["entities"] + document.metadata["graph_path"]["relations"]
        }
        assert not any("Umbrella" in value or "operates" in value for value in walked)

    def test_a_disabled_segment_does_not_skew_the_ranking(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset(max_depth=1)
        store = PostgresGraphStore(dataset)
        store.add_chunk_graphs(
            [
                # node-1 supports one matched fact, node-2 two -- but node-2 is
                # disabled, so the surviving chunk must score a clean 1.0 rather
                # than being normalized against a chunk nobody can see.
                _link("node-1", "doc-1", "acme", "globex", "acquired"),
                ChunkGraph(
                    index_node_id="node-2",
                    document_id="doc-2",
                    extraction=GraphExtraction(
                        entities=[_entity("acme"), _entity("globex"), _entity("initech")],
                        relations=[
                            GraphRelation(source="acme", target="globex", predicate="acquired"),
                            GraphRelation(source="acme", target="initech", predicate="funds"),
                        ],
                    ),
                ),
            ],
            session=session,
        )
        _segment(session, "node-1", "doc-1", "Acme acquired Globex.")
        _segment(session, "node-2", "doc-2", "Acme acquired Globex and funds Initech.", enabled=False)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "What does Acme own?", top_k=10, session=session)

        assert [document.metadata["doc_id"] for document in documents] == ["node-1"]
        assert documents[0].metadata["score"] == 1.0

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


def _configured_dataset(**setting_overrides: object) -> Dataset:
    """A dataset whose graph is enabled *and* has an extraction model."""
    setting: dict[str, object] = {
        "enabled": True,
        "model_provider_name": "openai",
        "model_name": "gpt-4o-mini",
        "max_depth": 2,
        "hop_decay": 0.5,
        "max_seed_entities": 8,
    }
    setting.update(setting_overrides)
    return Dataset(
        id=DATASET_ID,
        tenant_id=TENANT_ID,
        name="kb",
        created_by="user-1",
        graph_index_setting=setting,
    )


@pytest.fixture
def llm_seeds(monkeypatch: pytest.MonkeyPatch) -> Callable[..., list[str]]:
    """Install a stand-in extractor for the LLM seed fallback.

    Returns the list of queries it was asked about, so a test can assert the
    fallback was -- or was not -- reached.
    """
    asked: list[str] = []

    def _install(*, mentions: list[str] | None = None, error: Exception | None = None) -> list[str]:
        class _Extractor:
            def __init__(self, *, tenant_id: str, setting: object) -> None:
                self.tenant_id = tenant_id
                self.setting = setting

            def extract_query_entities(self, query: str) -> list[str]:
                asked.append(query)
                if error:
                    raise error
                return mentions or []

        monkeypatch.setattr(graph_retrieval_module, "EntityRelationExtractor", _Extractor)
        return asked

    return _install


class _BrokenKeywordHandler:
    """A tokenizer that cannot load its model."""

    def extract_keywords(self, _text: str, _max_keywords_per_chunk: int | None = 10) -> set[str]:
        raise RuntimeError("the tokenizer model failed to load")


class TestTokenizerFallback:
    def test_a_broken_tokenizer_degrades_to_a_whitespace_split(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(jieba_handler_module, "JiebaKeywordTableHandler", _BrokenKeywordHandler)

        # A broken tokenizer must degrade to a usable probe rather than take
        # graph retrieval down with it.
        assert set(extract_query_keywords("Acme Globex")) == {"acme", "globex"}

    def test_the_fallback_still_normalizes_and_filters(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(jieba_handler_module, "JiebaKeywordTableHandler", _BrokenKeywordHandler)

        # Entity names are stored normalized, so the fallback probe has to be too.
        assert set(extract_query_keywords('a "Acme Corp." X')) == {"acme", "corp"}


class TestSettingResolution:
    def test_a_dataset_with_an_extraction_model_retrieves_normally(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _configured_dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "What did Acme buy?", 10, session=session)

        assert [document.metadata["doc_id"] for document in documents][0] == "node-1"

    def test_retrieval_survives_a_dataset_whose_setting_cannot_be_parsed(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _configured_dataset(max_depth=99)
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        # max_depth is bounded; a row that violates it disables the graph rather
        # than raising through the retrieval path a user is waiting on.
        assert GraphRetrieval.retrieve(dataset, "What did Acme buy?", 10, session=session) == []

    def test_a_graph_without_an_extraction_model_still_retrieves(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme"])

        # Only the LLM seed fallback needs a model; lexical retrieval does not,
        # so an existing graph keeps working while the model is reconfigured.
        assert GraphRetrieval.retrieve(dataset, "What did Acme buy?", 10, session=session) != []


class TestLlmSeedFallback:
    """The paid fallback for queries that match no entity name lexically."""

    def test_mentions_the_model_extracts_become_seeds(
        self,
        session: Session,
        seed_keywords: Callable[[list[str]], None],
        llm_seeds: Callable[..., list[str]],
    ) -> None:
        dataset = _configured_dataset()
        _build_chain_graph(session, dataset)
        seed_keywords([])
        asked = llm_seeds(mentions=["acme"])

        documents = GraphRetrieval.retrieve(dataset, "Who bought the widget maker?", 10, session=session)

        assert asked == ["Who bought the widget maker?"]
        assert [document.metadata["doc_id"] for document in documents][0] == "node-1"

    def test_a_partial_mention_falls_back_to_name_matching(
        self,
        session: Session,
        seed_keywords: Callable[[list[str]], None],
        llm_seeds: Callable[..., list[str]],
    ) -> None:
        dataset = _configured_dataset()
        _build_chain_graph(session, dataset)
        seed_keywords([])
        # "acm" is nobody's stored name, so the exact lookup misses and the
        # partial match is what rescues the query.
        llm_seeds(mentions=["acm"])

        documents = GraphRetrieval.retrieve(dataset, "Who bought the widget maker?", 10, session=session)

        assert documents != []

    def test_a_failing_model_leaves_the_query_empty_rather_than_erroring(
        self,
        session: Session,
        seed_keywords: Callable[[list[str]], None],
        llm_seeds: Callable[..., list[str]],
    ) -> None:
        dataset = _configured_dataset()
        _build_chain_graph(session, dataset)
        seed_keywords([])
        llm_seeds(error=RuntimeError("the provider is down"))

        # This is a fallback for a query that already matched nothing; an
        # exception here would fail a search that was going to be empty anyway.
        assert GraphRetrieval.retrieve(dataset, "Who bought the widget maker?", 10, session=session) == []

    def test_a_model_that_names_nothing_leaves_the_query_empty(
        self,
        session: Session,
        seed_keywords: Callable[[list[str]], None],
        llm_seeds: Callable[..., list[str]],
    ) -> None:
        dataset = _configured_dataset()
        _build_chain_graph(session, dataset)
        seed_keywords([])
        llm_seeds(mentions=[])

        assert GraphRetrieval.retrieve(dataset, "Who bought the widget maker?", 10, session=session) == []

    def test_the_fallback_can_be_turned_off_per_dataset(
        self,
        session: Session,
        seed_keywords: Callable[[list[str]], None],
        llm_seeds: Callable[..., list[str]],
    ) -> None:
        dataset = _configured_dataset(llm_query_fallback=False)
        _build_chain_graph(session, dataset)
        seed_keywords([])
        asked = llm_seeds(mentions=["acme"])

        # It costs one LLM call per query that misses, so a dataset must be able
        # to keep retrieval free.
        assert GraphRetrieval.retrieve(dataset, "Who bought the widget maker?", 10, session=session) == []
        assert asked == []

    def test_a_dataset_without_a_model_never_reaches_the_fallback(
        self,
        session: Session,
        seed_keywords: Callable[[list[str]], None],
        llm_seeds: Callable[..., list[str]],
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords([])
        asked = llm_seeds(mentions=["acme"])

        assert GraphRetrieval.retrieve(dataset, "Who bought the widget maker?", 10, session=session) == []
        assert asked == []

    def test_an_excluded_document_cannot_seed_through_the_model_either(
        self,
        session: Session,
        seed_keywords: Callable[[list[str]], None],
        llm_seeds: Callable[..., list[str]],
    ) -> None:
        dataset = _configured_dataset()
        _build_chain_graph(session, dataset)
        seed_keywords([])
        llm_seeds(mentions=["acme"])

        # Acme is mentioned only by doc-1. The document filter has to bound the
        # LLM-derived seeds exactly as it bounds the lexical ones, or the model
        # becomes a way around the caller's permissions.
        documents = GraphRetrieval.retrieve(
            dataset, "Who bought the widget maker?", 10, session=session, document_ids_filter=["doc-3"]
        )

        assert documents == []


class TestWalkTermination:
    def test_an_entity_with_no_edges_still_returns_its_own_chunk(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        PostgresGraphStore(dataset).add_chunk_graphs(
            [
                ChunkGraph(
                    index_node_id="node-1",
                    document_id="doc-1",
                    extraction=GraphExtraction(entities=[_entity("acme")]),
                )
            ],
            session=session,
        )
        _segment(session, "node-1", "doc-1", "Acme ships widgets.")
        seed_keywords(["acme"])

        documents = GraphRetrieval.retrieve(dataset, "Tell me about Acme", 10, session=session)

        # The walk has nowhere to go, but the seed itself is still a citable hit.
        assert [document.metadata["doc_id"] for document in documents] == ["node-1"]

    def test_facts_whose_chunks_have_no_segment_yield_nothing(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        store = PostgresGraphStore(dataset)
        store.add_chunk_graphs([_link("node-1", "doc-1", "acme", "globex", "acquired")], session=session)
        seed_keywords(["acme"])

        # The graph can outlive the segments it was built from; a fact with no
        # chunk to cite must not surface as a result.
        assert GraphRetrieval.retrieve(dataset, "What did Acme buy?", 10, session=session) == []


class TestEdgeOrientation:
    def test_an_edge_between_two_seeds_is_walked_from_the_better_scoring_end(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        # Both endpoints of the acme->globex edge are seeds, so the walk has to
        # pick an end rather than counting the edge twice or dropping it.
        seed_keywords(["acme", "globex"])

        documents = GraphRetrieval.retrieve(dataset, "Acme and Globex", 10, session=session)

        node_ids = [document.metadata["doc_id"] for document in documents]
        assert "node-1" in node_ids
        # Reached from the Globex seed in one hop, so it still ranks.
        assert "node-2" in node_ids

    def test_a_two_seed_walk_reports_one_path_per_chunk(
        self, session: Session, seed_keywords: Callable[[list[str]], None]
    ) -> None:
        dataset = _dataset()
        _build_chain_graph(session, dataset)
        seed_keywords(["acme", "globex"])

        documents = GraphRetrieval.retrieve(dataset, "Acme and Globex", 10, session=session)

        for document in documents:
            path = document.metadata["graph_path"]
            assert path is not None
            # The explanation names a seed the caller was allowed to match.
            assert path["seed_entity"] in {"Acme", "Globex"}


def _stored_relation(relation_id: str, source: str, target: str) -> StoredRelation:
    return StoredRelation(
        id=relation_id,
        source_entity_id=source,
        target_entity_id=target,
        predicate="acquired",
    )


def _entity_hit(entity_id: str, score: float) -> graph_retrieval_module._EntityHit:
    return graph_retrieval_module._EntityHit(
        entity_id=entity_id,
        score=score,
        hop=0,
        seed_display_name=entity_id.title(),
        path_entities=[entity_id.title()],
    )


class TestOrientDirectly:
    """`_orient` decides which end of an edge the walk came from.

    Its tie-break and its give-up branch are unreachable from `retrieve` -- the
    walk only ever asks the store for edges touching the frontier, and a uniform
    hop decay gives every entity in one hop the same score -- so they are pinned
    here against the contract they document.
    """

    def test_the_better_scoring_endpoint_becomes_the_parent(self) -> None:
        relation = _stored_relation("relation-1", "acme", "globex")
        hits = {"acme": _entity_hit("acme", 0.25), "globex": _entity_hit("globex", 1.0)}

        parent, child = GraphRetrieval._orient(relation, {"acme", "globex"}, hits)

        # The child should inherit the strongest path available, not whichever
        # end happens to be the edge's source.
        assert (parent, child) == ("globex", "acme")

    def test_a_tie_keeps_the_edge_pointing_forwards(self) -> None:
        relation = _stored_relation("relation-1", "acme", "globex")
        hits = {"acme": _entity_hit("acme", 1.0), "globex": _entity_hit("globex", 1.0)}

        assert GraphRetrieval._orient(relation, {"acme", "globex"}, hits) == ("acme", "globex")

    def test_an_edge_touching_the_frontier_is_walked_from_that_end(self) -> None:
        relation = _stored_relation("relation-1", "acme", "globex")
        hits = {"globex": _entity_hit("globex", 1.0)}

        assert GraphRetrieval._orient(relation, {"globex"}, hits) == ("globex", "acme")

    def test_an_edge_touching_neither_end_of_the_frontier_is_skipped(self) -> None:
        relation = _stored_relation("relation-1", "acme", "globex")

        # Nothing to inherit a score from, so the edge cannot be scored at all.
        assert GraphRetrieval._orient(relation, {"initech"}, {}) == (None, None)


class TestScoreChunksDirectly:
    """`_score_chunks` refuses to score anything it cannot explain.

    Every guard below is unreachable through `retrieve`, which only ever asks
    for links belonging to entities and relations it already scored, but each
    one keeps an unexplainable chunk out of the ranking.
    """

    def test_a_link_to_an_unscored_entity_is_ignored(self) -> None:
        links = [StoredChunkLink(index_node_id="node-1", document_id="doc-1", entity_id="unknown")]

        scores, paths = GraphRetrieval._score_chunks(links, {}, {}, visible={"node-1"})

        assert scores == {}
        assert paths == {}

    def test_a_link_to_an_unscored_relation_is_ignored(self) -> None:
        links = [StoredChunkLink(index_node_id="node-1", document_id="doc-1", relation_id="unknown")]

        assert GraphRetrieval._score_chunks(links, {}, {}, visible={"node-1"}) == ({}, {})

    def test_a_link_that_cites_neither_a_node_nor_an_edge_is_ignored(self) -> None:
        links = [StoredChunkLink(index_node_id="node-1", document_id="doc-1")]

        assert GraphRetrieval._score_chunks(links, {}, {}, visible={"node-1"}) == ({}, {})

    def test_an_invisible_chunk_cannot_influence_the_ranking(self) -> None:
        links = [StoredChunkLink(index_node_id="node-1", document_id="doc-1", entity_id="acme")]
        hits = {"acme": _entity_hit("acme", 1.0)}

        # A disabled or still-indexing chunk must not even set the maximum the
        # other chunks are normalized against.
        assert GraphRetrieval._score_chunks(links, hits, {}, visible=set()) == ({}, {})

    def test_scores_are_normalized_against_the_strongest_chunk(self) -> None:
        links = [
            StoredChunkLink(index_node_id="node-1", document_id="doc-1", entity_id="acme"),
            StoredChunkLink(index_node_id="node-2", document_id="doc-2", entity_id="globex"),
        ]
        hits = {"acme": _entity_hit("acme", 1.0), "globex": _entity_hit("globex", 0.5)}

        scores, paths = GraphRetrieval._score_chunks(links, hits, {}, visible={"node-1", "node-2"})

        assert scores == {"node-1": 1.0, "node-2": 0.5}
        assert paths["node-1"].seed_entity == "Acme"
