"""Neo4j backend for the knowledge graph.

Enabled with ``GRAPH_STORE=neo4j``; requires ``uv sync --group graph-neo4j``.

Nodes and edges are namespaced by ``dataset_id`` so a single Neo4j instance can
serve many knowledge bases. Chunk provenance is stored as ``MENTIONED_IN``
edges to ``:DifyChunk`` nodes, which keeps the same citation guarantees as the
Postgres backend: every retrieved fact resolves to an ``index_node_id``.
"""

import logging
import threading
from typing import Any, override

from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.datasource.graph.graph_base import (
    BaseGraphStore,
    GraphStats,
    StoredChunkLink,
    StoredEntity,
    StoredRelation,
)
from core.rag.graph.entities import UNKNOWN_ENTITY_TYPE, ChunkGraph
from models.dataset import Dataset

logger = logging.getLogger(__name__)

_driver_lock = threading.Lock()
_driver: Any = None


def _get_driver() -> Any:
    """Return a process-wide Neo4j driver, created on first use.

    The driver is thread-safe and pools connections internally, so one instance
    is shared rather than reconnecting per request.
    """
    global _driver
    if _driver is not None:
        return _driver
    with _driver_lock:
        if _driver is not None:
            return _driver
        try:
            from neo4j import GraphDatabase  # type: ignore[import-not-found]  # pyrefly: ignore[missing-import]
        except ImportError as e:
            raise ImportError(
                "The neo4j driver is required when GRAPH_STORE=neo4j. Install it with `uv sync --group graph-neo4j`."
            ) from e
        _driver = GraphDatabase.driver(
            dify_config.KNOWLEDGE_GRAPH_NEO4J_URI,
            auth=(dify_config.KNOWLEDGE_GRAPH_NEO4J_USER, dify_config.KNOWLEDGE_GRAPH_NEO4J_PASSWORD),
        )
        return _driver


class Neo4jGraphStore(BaseGraphStore):
    """Graph store backed by Neo4j.

    The ``session`` argument required by :class:`BaseGraphStore` is unused here;
    all state lives in Neo4j.
    """

    def __init__(self, dataset: Dataset):
        super().__init__(dataset)
        self._database = dify_config.KNOWLEDGE_GRAPH_NEO4J_DATABASE
        self._ensure_constraints()

    def _session(self):
        return _get_driver().session(database=self._database)

    def _ensure_constraints(self) -> None:
        with self._session() as session:
            session.run(
                "CREATE CONSTRAINT dify_entity_key IF NOT EXISTS "
                "FOR (e:DifyEntity) REQUIRE (e.dataset_id, e.name) IS UNIQUE"
            )
            session.run(
                "CREATE CONSTRAINT dify_chunk_key IF NOT EXISTS "
                "FOR (c:DifyChunk) REQUIRE (c.dataset_id, c.index_node_id) IS UNIQUE"
            )

    @override
    def add_chunk_graphs(self, chunk_graphs: list[ChunkGraph], *, session: Session) -> None:
        if not chunk_graphs:
            return
        entity_rows: list[dict[str, Any]] = []
        relation_rows: list[dict[str, Any]] = []
        chunk_ids: list[str] = []
        for chunk_graph in chunk_graphs:
            chunk_ids.append(chunk_graph.index_node_id)
            for entity in chunk_graph.extraction.entities:
                entity_rows.append(
                    {
                        "name": entity.name,
                        "display_name": entity.display_name or entity.name,
                        "entity_type": entity.entity_type or UNKNOWN_ENTITY_TYPE,
                        "description": entity.description,
                        "index_node_id": chunk_graph.index_node_id,
                        "document_id": chunk_graph.document_id,
                    }
                )
            for relation in chunk_graph.extraction.relations:
                relation_rows.append(
                    {
                        "source": relation.source,
                        "target": relation.target,
                        "predicate": relation.predicate,
                        "description": relation.description,
                        "index_node_id": chunk_graph.index_node_id,
                        "document_id": chunk_graph.document_id,
                    }
                )

        with self._session() as neo_session:
            # Re-indexing a chunk replaces its provenance rather than duplicating it.
            neo_session.run(
                "MATCH (c:DifyChunk {dataset_id: $dataset_id}) WHERE c.index_node_id IN $chunk_ids DETACH DELETE c",
                dataset_id=self.dataset.id,
                chunk_ids=chunk_ids,
            )
            if entity_rows:
                neo_session.run(
                    """
                    UNWIND $rows AS row
                    MERGE (e:DifyEntity {dataset_id: $dataset_id, name: row.name})
                      ON CREATE SET e.id = randomUUID(), e.display_name = row.display_name,
                                    e.entity_type = row.entity_type, e.description = row.description,
                                    e.frequency = 1, e.tenant_id = $tenant_id
                      ON MATCH SET e.frequency = e.frequency + 1,
                                   e.entity_type = CASE WHEN e.entity_type = $unknown_type
                                                        THEN row.entity_type ELSE e.entity_type END,
                                   e.description = CASE WHEN row.description = '' OR
                                                             e.description CONTAINS row.description
                                                        THEN e.description
                                                        ELSE e.description + '\\n' + row.description END
                    MERGE (c:DifyChunk {dataset_id: $dataset_id, index_node_id: row.index_node_id})
                      ON CREATE SET c.document_id = row.document_id, c.tenant_id = $tenant_id
                    MERGE (e)-[:MENTIONED_IN]->(c)
                    """,
                    rows=entity_rows,
                    dataset_id=self.dataset.id,
                    tenant_id=self.dataset.tenant_id,
                    unknown_type=UNKNOWN_ENTITY_TYPE,
                )
            if relation_rows:
                neo_session.run(
                    """
                    UNWIND $rows AS row
                    MATCH (s:DifyEntity {dataset_id: $dataset_id, name: row.source})
                    MATCH (t:DifyEntity {dataset_id: $dataset_id, name: row.target})
                    MERGE (s)-[r:DIFY_RELATION {predicate: row.predicate}]->(t)
                      ON CREATE SET r.id = randomUUID(), r.description = row.description, r.weight = 1.0
                      ON MATCH SET r.weight = r.weight + 1.0
                    MERGE (c:DifyChunk {dataset_id: $dataset_id, index_node_id: row.index_node_id})
                      ON CREATE SET c.document_id = row.document_id, c.tenant_id = $tenant_id
                    MERGE (c)-[:SUPPORTS {relation_id: r.id}]->(s)
                    """,
                    rows=relation_rows,
                    dataset_id=self.dataset.id,
                    tenant_id=self.dataset.tenant_id,
                )

    @override
    def delete_by_document_ids(self, document_ids: list[str], *, session: Session) -> None:
        if not document_ids:
            return
        with self._session() as neo_session:
            neo_session.run(
                "MATCH (c:DifyChunk {dataset_id: $dataset_id}) WHERE c.document_id IN $document_ids DETACH DELETE c",
                dataset_id=self.dataset.id,
                document_ids=document_ids,
            )
            self._prune_orphans(neo_session)

    @override
    def delete_by_index_node_ids(self, index_node_ids: list[str], *, session: Session) -> None:
        if not index_node_ids:
            return
        with self._session() as neo_session:
            neo_session.run(
                "MATCH (c:DifyChunk {dataset_id: $dataset_id}) WHERE c.index_node_id IN $chunk_ids DETACH DELETE c",
                dataset_id=self.dataset.id,
                chunk_ids=index_node_ids,
            )
            self._prune_orphans(neo_session)

    @override
    def delete(self, *, session: Session) -> None:
        with self._session() as neo_session:
            neo_session.run(
                "MATCH (n) WHERE (n:DifyEntity OR n:DifyChunk) AND n.dataset_id = $dataset_id DETACH DELETE n",
                dataset_id=self.dataset.id,
            )

    def _prune_orphans(self, neo_session: Any) -> None:
        neo_session.run(
            "MATCH (e:DifyEntity {dataset_id: $dataset_id}) "
            "WHERE NOT (e)-[:MENTIONED_IN]->(:DifyChunk) DETACH DELETE e",
            dataset_id=self.dataset.id,
        )

    @override
    def get_entities_by_names(self, names: list[str], *, session: Session) -> list[StoredEntity]:
        if not names:
            return []
        with self._session() as neo_session:
            records = neo_session.run(
                "MATCH (e:DifyEntity {dataset_id: $dataset_id}) WHERE e.name IN $names RETURN e",
                dataset_id=self.dataset.id,
                names=names,
            )
            return [self._to_entity(record["e"]) for record in records]

    @override
    def search_entities(self, keywords: list[str], limit: int, *, session: Session) -> list[StoredEntity]:
        cleaned = [keyword for keyword in (k.strip() for k in keywords) if keyword]
        if not cleaned:
            return []
        with self._session() as neo_session:
            records = neo_session.run(
                "MATCH (e:DifyEntity {dataset_id: $dataset_id}) "
                "WHERE any(kw IN $keywords WHERE e.name CONTAINS kw) "
                "RETURN e ORDER BY e.frequency DESC LIMIT $limit",
                dataset_id=self.dataset.id,
                keywords=cleaned,
                limit=limit,
            )
            return [self._to_entity(record["e"]) for record in records]

    @override
    def get_entities_by_ids(self, entity_ids: list[str], *, session: Session) -> list[StoredEntity]:
        if not entity_ids:
            return []
        with self._session() as neo_session:
            records = neo_session.run(
                "MATCH (e:DifyEntity {dataset_id: $dataset_id}) WHERE e.id IN $ids RETURN e",
                dataset_id=self.dataset.id,
                ids=entity_ids,
            )
            return [self._to_entity(record["e"]) for record in records]

    @override
    def list_entities(self, limit: int, *, session: Session) -> list[StoredEntity]:
        with self._session() as neo_session:
            records = neo_session.run(
                "MATCH (e:DifyEntity {dataset_id: $dataset_id}) RETURN e ORDER BY e.frequency DESC LIMIT $limit",
                dataset_id=self.dataset.id,
                limit=limit,
            )
            return [self._to_entity(record["e"]) for record in records]

    @override
    def get_relations(self, entity_ids: list[str], limit: int, *, session: Session) -> list[StoredRelation]:
        if not entity_ids:
            return []
        with self._session() as neo_session:
            records = neo_session.run(
                "MATCH (s:DifyEntity {dataset_id: $dataset_id})-[r:DIFY_RELATION]->"
                "(t:DifyEntity {dataset_id: $dataset_id}) "
                "WHERE s.id IN $ids OR t.id IN $ids "
                "RETURN r, s.id AS source_id, t.id AS target_id ORDER BY r.weight DESC LIMIT $limit",
                dataset_id=self.dataset.id,
                ids=entity_ids,
                limit=limit,
            )
            return [
                StoredRelation(
                    id=record["r"].get("id", ""),
                    source_entity_id=record["source_id"],
                    target_entity_id=record["target_id"],
                    predicate=record["r"].get("predicate", "related_to"),
                    description=record["r"].get("description") or "",
                    weight=float(record["r"].get("weight", 1.0)),
                )
                for record in records
            ]

    @override
    def get_chunk_links(
        self,
        entity_ids: list[str],
        relation_ids: list[str],
        *,
        session: Session,
    ) -> list[StoredChunkLink]:
        links: list[StoredChunkLink] = []
        with self._session() as neo_session:
            if entity_ids:
                records = neo_session.run(
                    "MATCH (e:DifyEntity {dataset_id: $dataset_id})-[:MENTIONED_IN]->(c:DifyChunk) "
                    "WHERE e.id IN $ids RETURN e.id AS entity_id, c.index_node_id AS index_node_id, "
                    "c.document_id AS document_id",
                    dataset_id=self.dataset.id,
                    ids=entity_ids,
                )
                links.extend(
                    StoredChunkLink(
                        index_node_id=record["index_node_id"],
                        document_id=record["document_id"],
                        entity_id=record["entity_id"],
                    )
                    for record in records
                )
            if relation_ids:
                records = neo_session.run(
                    "MATCH (c:DifyChunk {dataset_id: $dataset_id})-[s:SUPPORTS]->(:DifyEntity) "
                    "WHERE s.relation_id IN $ids RETURN s.relation_id AS relation_id, "
                    "c.index_node_id AS index_node_id, c.document_id AS document_id",
                    dataset_id=self.dataset.id,
                    ids=relation_ids,
                )
                links.extend(
                    StoredChunkLink(
                        index_node_id=record["index_node_id"],
                        document_id=record["document_id"],
                        relation_id=record["relation_id"],
                    )
                    for record in records
                )
        return links

    @override
    def stats(self, *, session: Session) -> GraphStats:
        with self._session() as neo_session:
            entity_count = (
                neo_session.run(
                    "MATCH (e:DifyEntity {dataset_id: $dataset_id}) RETURN count(e) AS c",
                    dataset_id=self.dataset.id,
                ).single()
                or {"c": 0}
            )["c"]
            relation_count = (
                neo_session.run(
                    "MATCH (:DifyEntity {dataset_id: $dataset_id})-[r:DIFY_RELATION]->"
                    "(:DifyEntity {dataset_id: $dataset_id}) RETURN count(r) AS c",
                    dataset_id=self.dataset.id,
                ).single()
                or {"c": 0}
            )["c"]
            type_records = neo_session.run(
                "MATCH (e:DifyEntity {dataset_id: $dataset_id}) RETURN e.entity_type AS entity_type, count(e) AS c",
                dataset_id=self.dataset.id,
            )
            entity_types = {record["entity_type"]: record["c"] for record in type_records}
        return GraphStats(
            entity_count=int(entity_count),
            relation_count=int(relation_count),
            entity_types=entity_types,
        )

    @staticmethod
    def _to_entity(node: Any) -> StoredEntity:
        return StoredEntity(
            id=node.get("id", ""),
            name=node.get("name", ""),
            display_name=node.get("display_name") or node.get("name", ""),
            entity_type=node.get("entity_type") or UNKNOWN_ENTITY_TYPE,
            description=node.get("description") or "",
            frequency=int(node.get("frequency", 1)),
        )
