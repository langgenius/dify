"""Multi-hop retrieval over a dataset's knowledge graph.

The walk is deliberately shallow and breadth-limited: it exists to surface
chunks that vector similarity misses because the connection between the
question and the answer spans several documents, not to replace ranking. Every
hit resolves to a ``DocumentSegment``, so graph results are cited exactly like
vector results.
"""

import logging
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.datasource.graph.graph_base import StoredEntity, StoredRelation
from core.rag.datasource.graph.graph_factory import GraphStore
from core.rag.graph.entities import GraphIndexSetting, RetrievedGraphPath, normalize_entity_name
from core.rag.graph.entity_extractor import EntityRelationExtractor
from core.rag.models.document import Document
from models.dataset import Dataset, DocumentSegment
from models.enums import SegmentStatus

logger = logging.getLogger(__name__)

# Number of query keywords fed to the entity lookup.
MAX_QUERY_KEYWORDS = 12
# Keywords shorter than this match far too many entity names to be useful.
MIN_KEYWORD_LENGTH = 2


@dataclass
class _EntityHit:
    """An entity reached by the walk, with the path that led to it."""

    entity_id: str
    score: float
    hop: int
    seed_display_name: str
    path_entities: list[str] = field(default_factory=list)
    path_relations: list[str] = field(default_factory=list)


@dataclass
class _RelationHit:
    relation: StoredRelation
    score: float
    hop: int
    seed_display_name: str
    path_entities: list[str] = field(default_factory=list)
    path_relations: list[str] = field(default_factory=list)


def extract_query_keywords(query: str) -> list[str]:
    """Tokenize a query into candidate entity-name fragments.

    Reuses the jieba handler already used by the economy index so CJK and
    space-delimited languages are both handled.
    """
    from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler

    try:
        raw_keywords = JiebaKeywordTableHandler().extract_keywords(query, MAX_QUERY_KEYWORDS)
    except Exception:
        logger.warning("Query tokenization failed, falling back to whitespace splitting", exc_info=True)
        raw_keywords = set(query.split())

    keywords: list[str] = []
    seen: set[str] = set()
    for raw in raw_keywords:
        # Entity names are stored normalized, so normalize the probe too.
        keyword = normalize_entity_name(raw)
        if len(keyword) < MIN_KEYWORD_LENGTH or keyword in seen:
            continue
        seen.add(keyword)
        keywords.append(keyword)
    return keywords


class GraphRetrieval:
    @classmethod
    def retrieve(
        cls,
        dataset: Dataset,
        query: str,
        top_k: int,
        *,
        session: Session,
        document_ids_filter: list[str] | None = None,
    ) -> list[Document]:
        """Return chunks reachable from entities mentioned in ``query``.

        Returns an empty list when the dataset has no graph, when no entity in
        the query matches the graph, or when the walk reaches no chunk.
        """
        setting = cls._get_setting(dataset)
        if not setting or not query or not query.strip():
            return []

        store = GraphStore(dataset)
        seeds = cls._find_seed_entities(store, dataset, query, setting, session=session)
        if not seeds:
            return []

        entity_hits, relation_hits = cls._walk(store, seeds, setting, session=session)
        if not entity_hits and not relation_hits:
            return []

        chunk_scores, chunk_paths = cls._score_chunks(store, entity_hits, relation_hits, session=session)
        if not chunk_scores:
            return []

        return cls._build_documents(
            dataset,
            chunk_scores,
            chunk_paths,
            top_k,
            session=session,
            document_ids_filter=document_ids_filter,
        )

    @staticmethod
    def _get_setting(dataset: Dataset) -> GraphIndexSetting | None:
        from core.rag.graph.graph_index_service import GraphIndexService

        setting = GraphIndexService.get_setting(dataset)
        if setting:
            return setting
        # Retrieval still works without an extraction model configured; only the
        # LLM seed fallback is unavailable in that case.
        raw = dataset.graph_index_setting
        if not raw:
            return None
        try:
            parsed = GraphIndexSetting.model_validate(raw)
        except Exception:
            return None
        return parsed if parsed.enabled else None

    @classmethod
    def _find_seed_entities(
        cls,
        store: GraphStore,
        dataset: Dataset,
        query: str,
        setting: GraphIndexSetting,
        *,
        session: Session,
    ) -> list[StoredEntity]:
        """Match the query against entity names, lexically first, then via the LLM.

        Lexical matching is free and handles the common case where the question
        names an entity outright. The LLM fallback only runs when that finds
        nothing, which keeps the cost of graph retrieval near zero for most
        queries.
        """
        keywords = extract_query_keywords(query)
        seeds = store.search_entities(keywords, setting.max_seed_entities, session=session) if keywords else []
        if seeds:
            return seeds

        if not setting.model_provider_name or not setting.model_name:
            return []
        try:
            extractor = EntityRelationExtractor(tenant_id=dataset.tenant_id, setting=setting)
            mentions = extractor.extract_query_entities(query)
        except Exception:
            logger.warning("LLM seed-entity extraction failed for dataset %s", dataset.id, exc_info=True)
            return []
        if not mentions:
            return []

        seeds = store.get_entities_by_names(mentions, session=session)
        if seeds:
            return seeds[: setting.max_seed_entities]
        # Fall back to partial matching on the extracted mentions.
        return store.search_entities(mentions, setting.max_seed_entities, session=session)

    @classmethod
    def _walk(
        cls,
        store: GraphStore,
        seeds: list[StoredEntity],
        setting: GraphIndexSetting,
        *,
        session: Session,
    ) -> tuple[dict[str, _EntityHit], dict[str, _RelationHit]]:
        """Breadth-first walk out from the seeds, decaying the score per hop."""
        entity_hits: dict[str, _EntityHit] = {}
        relation_hits: dict[str, _RelationHit] = {}
        known_entities: dict[str, StoredEntity] = {seed.id: seed for seed in seeds}

        for seed in seeds:
            entity_hits[seed.id] = _EntityHit(
                entity_id=seed.id,
                score=1.0,
                hop=0,
                seed_display_name=seed.display_name,
                path_entities=[seed.display_name],
            )

        frontier = [seed.id for seed in seeds]
        for hop in range(1, setting.max_depth + 1):
            if not frontier:
                break
            relations = store.get_relations(frontier, setting.max_neighbors_per_hop, session=session)
            if not relations:
                break

            # Resolve display names for any endpoint we have not seen yet.
            unknown_ids = {
                endpoint
                for relation in relations
                for endpoint in (relation.source_entity_id, relation.target_entity_id)
                if endpoint not in known_entities
            }
            if unknown_ids:
                for entity in store.get_entities_by_ids(list(unknown_ids), session=session):
                    known_entities[entity.id] = entity

            frontier_set = set(frontier)
            next_frontier: list[str] = []
            for relation in relations:
                parent_id, child_id = cls._orient(relation, frontier_set, entity_hits)
                if parent_id is None or child_id is None:
                    continue
                parent_hit = entity_hits[parent_id]
                score = parent_hit.score * setting.hop_decay

                child = known_entities.get(child_id)
                child_name = child.display_name if child else child_id
                parent = known_entities.get(parent_id)
                parent_name = parent.display_name if parent else parent_id
                source_name = parent_name if relation.source_entity_id == parent_id else child_name
                target_name = child_name if relation.source_entity_id == parent_id else parent_name
                triple = f"{source_name} -[{relation.predicate}]-> {target_name}"

                path_entities = [*parent_hit.path_entities, child_name]
                path_relations = [*parent_hit.path_relations, triple]

                existing_relation_hit = relation_hits.get(relation.id)
                if existing_relation_hit is None or score > existing_relation_hit.score:
                    relation_hits[relation.id] = _RelationHit(
                        relation=relation,
                        score=score,
                        hop=hop,
                        seed_display_name=parent_hit.seed_display_name,
                        path_entities=path_entities,
                        path_relations=path_relations,
                    )

                existing_entity_hit = entity_hits.get(child_id)
                if existing_entity_hit is None:
                    entity_hits[child_id] = _EntityHit(
                        entity_id=child_id,
                        score=score,
                        hop=hop,
                        seed_display_name=parent_hit.seed_display_name,
                        path_entities=path_entities,
                        path_relations=path_relations,
                    )
                    next_frontier.append(child_id)
                elif score > existing_entity_hit.score:
                    existing_entity_hit.score = score
                    existing_entity_hit.hop = hop
                    existing_entity_hit.seed_display_name = parent_hit.seed_display_name
                    existing_entity_hit.path_entities = path_entities
                    existing_entity_hit.path_relations = path_relations

            frontier = next_frontier

        return entity_hits, relation_hits

    @staticmethod
    def _orient(
        relation: StoredRelation,
        frontier: set[str],
        entity_hits: dict[str, _EntityHit],
    ) -> tuple[str | None, str | None]:
        """Decide which end of an edge we are walking from.

        Edges are traversed in both directions; when both endpoints are on the
        frontier the better-scoring one is treated as the parent so the child
        inherits the strongest available path.
        """
        source_in = relation.source_entity_id in frontier
        target_in = relation.target_entity_id in frontier
        if source_in and target_in:
            source_score = entity_hits[relation.source_entity_id].score
            target_score = entity_hits[relation.target_entity_id].score
            if source_score >= target_score:
                return relation.source_entity_id, relation.target_entity_id
            return relation.target_entity_id, relation.source_entity_id
        if source_in:
            return relation.source_entity_id, relation.target_entity_id
        if target_in:
            return relation.target_entity_id, relation.source_entity_id
        return None, None

    @classmethod
    def _score_chunks(
        cls,
        store: GraphStore,
        entity_hits: dict[str, _EntityHit],
        relation_hits: dict[str, _RelationHit],
        *,
        session: Session,
    ) -> tuple[dict[str, float], dict[str, RetrievedGraphPath]]:
        """Aggregate node/edge scores onto the chunks that support them.

        Scores are summed so a chunk supporting several matched facts outranks
        one supporting a single fact, then normalized to ``(0, 1]`` so they sit
        on the same scale as vector scores when the two are merged.
        """
        links = store.get_chunk_links(list(entity_hits.keys()), list(relation_hits.keys()), session=session)
        if not links:
            return {}, {}

        chunk_scores: dict[str, float] = defaultdict(float)
        best_hit: dict[str, tuple[float, RetrievedGraphPath]] = {}

        for link in links:
            if link.entity_id is not None:
                hit = entity_hits.get(link.entity_id)
                if hit is None:
                    continue
                score, hop, seed = hit.score, hit.hop, hit.seed_display_name
                path_entities, path_relations = hit.path_entities, hit.path_relations
            elif link.relation_id is not None:
                relation_hit = relation_hits.get(link.relation_id)
                if relation_hit is None:
                    continue
                score, hop = relation_hit.score, relation_hit.hop
                seed = relation_hit.seed_display_name
                path_entities, path_relations = relation_hit.path_entities, relation_hit.path_relations
            else:
                continue

            chunk_scores[link.index_node_id] += score
            current_best = best_hit.get(link.index_node_id)
            if current_best is None or score > current_best[0]:
                best_hit[link.index_node_id] = (
                    score,
                    RetrievedGraphPath(
                        seed_entity=seed,
                        hop=hop,
                        entities=path_entities,
                        relations=path_relations,
                    ),
                )

        max_score = max(chunk_scores.values())
        normalized = {node_id: score / max_score for node_id, score in chunk_scores.items()}
        return normalized, {node_id: path for node_id, (_, path) in best_hit.items()}

    @classmethod
    def _build_documents(
        cls,
        dataset: Dataset,
        chunk_scores: dict[str, float],
        chunk_paths: dict[str, RetrievedGraphPath],
        top_k: int,
        *,
        session: Session,
        document_ids_filter: list[str] | None = None,
    ) -> list[Document]:
        """Resolve scored chunk ids to segments, preserving citation metadata."""
        ranked_node_ids = sorted(chunk_scores, key=lambda node_id: chunk_scores[node_id], reverse=True)[:top_k]
        if not ranked_node_ids:
            return []

        stmt = select(DocumentSegment).where(
            DocumentSegment.dataset_id == dataset.id,
            DocumentSegment.index_node_id.in_(ranked_node_ids),
            # A disabled or still-indexing segment must never surface, even
            # though its facts may linger in the graph until the next rebuild.
            DocumentSegment.enabled == True,
            DocumentSegment.status == SegmentStatus.COMPLETED,
        )
        if document_ids_filter:
            stmt = stmt.where(DocumentSegment.document_id.in_(document_ids_filter))

        segments = session.scalars(stmt).all()
        segment_map = {segment.index_node_id: segment for segment in segments}

        documents: list[Document] = []
        for node_id in ranked_node_ids:
            segment = segment_map.get(node_id)
            if not segment:
                continue
            path = chunk_paths.get(node_id)
            documents.append(
                Document(
                    page_content=segment.content,
                    metadata={
                        "doc_id": node_id,
                        "doc_hash": segment.index_node_hash,
                        "document_id": segment.document_id,
                        "dataset_id": segment.dataset_id,
                        "score": chunk_scores[node_id],
                        "retrieval_source": "knowledge_graph",
                        "graph_path": path.model_dump() if path else None,
                    },
                )
            )
        return documents
