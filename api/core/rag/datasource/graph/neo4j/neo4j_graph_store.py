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
from core.rag.datasource.graph.graph_lock import graph_index_lock
from core.rag.graph.entities import UNKNOWN_ENTITY_TYPE, ChunkGraph
from models.dataset import Dataset

logger = logging.getLogger(__name__)

_driver_lock = threading.Lock()
_driver: Any = None
_schema_lock = threading.Lock()
_schema_ready = False

# Constraints and indexes are global to the Neo4j database, not per dataset, so
# they are created once per process instead of on every store construction --
# retrieval builds a store per query and paid two DDL round-trips for nothing.
_SCHEMA_STATEMENTS = (
    "CREATE CONSTRAINT dify_entity_key IF NOT EXISTS FOR (e:DifyEntity) REQUIRE (e.dataset_id, e.name) IS UNIQUE",
    "CREATE CONSTRAINT dify_chunk_key IF NOT EXISTS "
    "FOR (c:DifyChunk) REQUIRE (c.dataset_id, c.index_node_id) IS UNIQUE",
    # `list_entities`/`search_entities` order by frequency within a dataset.
    "CREATE INDEX dify_entity_frequency IF NOT EXISTS FOR (e:DifyEntity) ON (e.dataset_id, e.frequency)",
    # Entity ids are the currency of traversal: seeds, endpoints and chunk links
    # are all looked up by id.
    "CREATE INDEX dify_entity_id IF NOT EXISTS FOR (e:DifyEntity) ON (e.id)",
    # Provenance lookups and weight recomputation both probe SUPPORTS by the
    # relation they support.
    "CREATE INDEX dify_supports_relation IF NOT EXISTS FOR ()-[s:SUPPORTS]-() ON (s.relation_id)",
)


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


def _mentioned_in_clause(document_ids: list[str] | None) -> str:
    """Cypher restricting `e` to entities mentioned by one of ``$document_ids``.

    Written as a pattern comprehension rather than an ``EXISTS`` subquery so the
    same statement runs on Neo4j 4.x and 5.x.
    """
    if not document_ids:
        return ""
    return " AND size([(e)-[:MENTIONED_IN]->(c:DifyChunk) WHERE c.document_id IN $document_ids | c]) > 0"


class Neo4jGraphStore(BaseGraphStore):
    """Graph store backed by Neo4j.

    The ``session`` argument required by :class:`BaseGraphStore` is unused here;
    all state lives in Neo4j.
    """

    def __init__(self, dataset: Dataset):
        super().__init__(dataset)
        self._database = dify_config.KNOWLEDGE_GRAPH_NEO4J_DATABASE
        self._ensure_schema()

    def _session(self):
        return _get_driver().session(database=self._database)

    def _ensure_schema(self) -> None:
        """Create the shared constraints and indexes once per process."""
        global _schema_ready
        if _schema_ready:
            return
        with _schema_lock:
            if _schema_ready:
                return
            with self._session() as session:
                for statement in _SCHEMA_STATEMENTS:
                    session.run(statement)
            _schema_ready = True

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

        entity_names = sorted({row["name"] for row in entity_rows})

        # Serialize the merge across workers and wrap it in one transaction: a
        # mid-flight failure would otherwise leave entities without their
        # relations, and two concurrent re-indexes of the same document would
        # interleave their delete/insert phases.
        with graph_index_lock(self.dataset.id) as renew, self._session() as neo_session:

            def merge(tx: Any) -> None:
                # Re-indexing a chunk replaces its provenance rather than duplicating it.
                tx.run(
                    "MATCH (c:DifyChunk {dataset_id: $dataset_id}) WHERE c.index_node_id IN $chunk_ids DETACH DELETE c",
                    dataset_id=self.dataset.id,
                    chunk_ids=chunk_ids,
                )
                if entity_rows:
                    tx.run(
                        """
                        UNWIND $rows AS row
                        MERGE (e:DifyEntity {dataset_id: $dataset_id, name: row.name})
                          ON CREATE SET e.id = randomUUID(), e.display_name = row.display_name,
                                        e.entity_type = row.entity_type, e.description = row.description,
                                        e.frequency = 0, e.tenant_id = $tenant_id
                          ON MATCH SET e.entity_type = CASE WHEN e.entity_type = $unknown_type
                                                            THEN row.entity_type ELSE e.entity_type END,
                                       e.description = CASE WHEN row.description = '' OR
                                                                 e.description CONTAINS row.description
                                                            THEN e.description
                                                            ELSE e.description + '\n' + row.description END
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
                    tx.run(
                        """
                        UNWIND $rows AS row
                        MATCH (s:DifyEntity {dataset_id: $dataset_id, name: row.source})
                        MATCH (t:DifyEntity {dataset_id: $dataset_id, name: row.target})
                        MERGE (s)-[r:DIFY_RELATION {predicate: row.predicate}]->(t)
                          ON CREATE SET r.id = randomUUID(), r.description = row.description, r.weight = 0.0
                        MERGE (c:DifyChunk {dataset_id: $dataset_id, index_node_id: row.index_node_id})
                          ON CREATE SET c.document_id = row.document_id, c.tenant_id = $tenant_id
                        MERGE (c)-[:SUPPORTS {relation_id: r.id}]->(s)
                        """,
                        rows=relation_rows,
                        dataset_id=self.dataset.id,
                        tenant_id=self.dataset.tenant_id,
                    )
                self._recompute_counters(tx, entity_names=entity_names, relation_rows=relation_rows)

            renew()
            neo_session.execute_write(merge)

    @override
    def delete_by_document_ids(self, document_ids: list[str], *, session: Session) -> None:
        if not document_ids:
            return
        self._delete_chunks(
            "MATCH (c:DifyChunk {dataset_id: $dataset_id}) WHERE c.document_id IN $ids DETACH DELETE c",
            document_ids,
        )

    @override
    def delete_by_index_node_ids(self, index_node_ids: list[str], *, session: Session) -> None:
        if not index_node_ids:
            return
        self._delete_chunks(
            "MATCH (c:DifyChunk {dataset_id: $dataset_id}) WHERE c.index_node_id IN $ids DETACH DELETE c",
            index_node_ids,
        )

    def _delete_chunks(self, delete_query: str, ids: list[str]) -> None:
        """Drop chunks and everything left unsupported by them, in one transaction."""
        with graph_index_lock(self.dataset.id) as renew, self._session() as neo_session:

            def remove(tx: Any) -> None:
                tx.run(delete_query, dataset_id=self.dataset.id, ids=ids)
                self._prune_orphans(tx)

            renew()
            neo_session.execute_write(remove)

    @override
    def delete(self, *, session: Session) -> None:
        with self._session() as neo_session:
            neo_session.run(
                "MATCH (n) WHERE (n:DifyEntity OR n:DifyChunk) AND n.dataset_id = $dataset_id DETACH DELETE n",
                dataset_id=self.dataset.id,
            )

    def _prune_orphans(self, runner: Any) -> None:
        """Delete nodes and edges that no surviving chunk supports.

        Relations are pruned first, mirroring the Postgres backend: deleting the
        chunks that supported a fact removes its ``SUPPORTS`` edges but leaves
        the ``DIFY_RELATION`` edge itself in place, and traversal walks those by
        endpoint, so an unpruned edge would keep bridging live entities with a
        fact the user already deleted.
        """
        runner.run(
            "MATCH (:DifyEntity {dataset_id: $dataset_id})-[r:DIFY_RELATION]->"
            "(:DifyEntity {dataset_id: $dataset_id}) "
            "OPTIONAL MATCH ()-[sup:SUPPORTS {relation_id: r.id}]->() "
            "WITH r, count(sup) AS supported WHERE supported = 0 "
            "DELETE r",
            dataset_id=self.dataset.id,
        )
        runner.run(
            "MATCH (e:DifyEntity {dataset_id: $dataset_id}) "
            "WHERE NOT (e)-[:MENTIONED_IN]->(:DifyChunk) DETACH DELETE e",
            dataset_id=self.dataset.id,
        )
        # Whatever survived lost some of its support, so its counters are stale.
        self._recompute_counters(runner)

    def _recompute_counters(
        self,
        runner: Any,
        *,
        entity_names: list[str] | None = None,
        relation_rows: list[dict[str, Any]] | None = None,
    ) -> None:
        """Reset entity frequency and relation weight to their supporting-chunk counts.

        Both counters are defined as "how many chunks support this fact", so they
        are derived rather than incremented: an increment survives re-indexing
        and pruning as permanent drift, and `search_entities` ranks seeds by
        frequency, so the drift steers retrieval.

        With ``entity_names``/``relation_rows`` only the facts touched by one
        merge are recomputed; without them the whole dataset is, which is what
        pruning needs and what deletion can afford.
        """
        if entity_names is None:
            runner.run(
                "MATCH (e:DifyEntity {dataset_id: $dataset_id}) "
                "OPTIONAL MATCH (e)-[m:MENTIONED_IN]->(:DifyChunk) "
                "WITH e, count(m) AS mentions SET e.frequency = mentions",
                dataset_id=self.dataset.id,
            )
        elif entity_names:
            runner.run(
                "UNWIND $names AS name "
                "MATCH (e:DifyEntity {dataset_id: $dataset_id, name: name}) "
                "OPTIONAL MATCH (e)-[m:MENTIONED_IN]->(:DifyChunk) "
                "WITH e, count(m) AS mentions SET e.frequency = mentions",
                dataset_id=self.dataset.id,
                names=entity_names,
            )

        if relation_rows is None:
            runner.run(
                "MATCH (:DifyEntity {dataset_id: $dataset_id})-[r:DIFY_RELATION]->"
                "(:DifyEntity {dataset_id: $dataset_id}) "
                "OPTIONAL MATCH ()-[sup:SUPPORTS {relation_id: r.id}]->() "
                "WITH r, count(sup) AS supported SET r.weight = toFloat(supported)",
                dataset_id=self.dataset.id,
            )
        elif relation_rows:
            runner.run(
                "UNWIND $rows AS row "
                "MATCH (:DifyEntity {dataset_id: $dataset_id, name: row.source})"
                "-[r:DIFY_RELATION {predicate: row.predicate}]->"
                "(:DifyEntity {dataset_id: $dataset_id, name: row.target}) "
                "WITH DISTINCT r "
                "OPTIONAL MATCH ()-[sup:SUPPORTS {relation_id: r.id}]->() "
                "WITH r, count(sup) AS supported SET r.weight = toFloat(supported)",
                dataset_id=self.dataset.id,
                rows=relation_rows,
            )

    @override
    def get_entities_by_names(
        self,
        names: list[str],
        *,
        session: Session,
        document_ids: list[str] | None = None,
    ) -> list[StoredEntity]:
        if not names:
            return []
        with self._session() as neo_session:
            records = neo_session.run(
                "MATCH (e:DifyEntity {dataset_id: $dataset_id}) WHERE e.name IN $names"
                f"{_mentioned_in_clause(document_ids)} RETURN e",
                dataset_id=self.dataset.id,
                names=names,
                document_ids=document_ids,
            )
            return [self._to_entity(record["e"]) for record in records]

    @override
    def search_entities(
        self,
        keywords: list[str],
        limit: int,
        *,
        session: Session,
        document_ids: list[str] | None = None,
    ) -> list[StoredEntity]:
        cleaned = [keyword for keyword in (k.strip() for k in keywords) if keyword]
        if not cleaned:
            return []
        with self._session() as neo_session:
            records = neo_session.run(
                "MATCH (e:DifyEntity {dataset_id: $dataset_id}) "
                "WHERE any(kw IN $keywords WHERE e.name CONTAINS kw)"
                f"{_mentioned_in_clause(document_ids)} "
                "RETURN e ORDER BY e.frequency DESC LIMIT $limit",
                dataset_id=self.dataset.id,
                keywords=cleaned,
                limit=limit,
                document_ids=document_ids,
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
    def get_relations(
        self,
        entity_ids: list[str],
        limit: int,
        *,
        session: Session,
        document_ids: list[str] | None = None,
    ) -> list[StoredRelation]:
        if not entity_ids:
            return []
        # A relation only counts as coming from an allowed document when a chunk
        # of that document actually supports it.
        supported_clause = (
            " AND size([(c:DifyChunk)-[sup:SUPPORTS]->(:DifyEntity) "
            "WHERE sup.relation_id = r.id AND c.dataset_id = $dataset_id "
            "AND c.document_id IN $document_ids | c]) > 0"
            if document_ids
            else ""
        )
        with self._session() as neo_session:
            records = neo_session.run(
                "MATCH (s:DifyEntity {dataset_id: $dataset_id})-[r:DIFY_RELATION]->"
                "(t:DifyEntity {dataset_id: $dataset_id}) "
                "WHERE (s.id IN $ids OR t.id IN $ids)"
                f"{supported_clause} "
                "RETURN r, s.id AS source_id, t.id AS target_id ORDER BY r.weight DESC LIMIT $limit",
                dataset_id=self.dataset.id,
                ids=entity_ids,
                limit=limit,
                document_ids=document_ids,
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
        document_ids: list[str] | None = None,
    ) -> list[StoredChunkLink]:
        document_clause = " AND c.document_id IN $document_ids" if document_ids else ""
        links: list[StoredChunkLink] = []
        with self._session() as neo_session:
            if entity_ids:
                records = neo_session.run(
                    "MATCH (e:DifyEntity {dataset_id: $dataset_id})-[:MENTIONED_IN]->(c:DifyChunk) "
                    f"WHERE e.id IN $ids{document_clause} "
                    "RETURN e.id AS entity_id, c.index_node_id AS index_node_id, "
                    "c.document_id AS document_id",
                    dataset_id=self.dataset.id,
                    ids=entity_ids,
                    document_ids=document_ids,
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
                    f"WHERE s.relation_id IN $ids{document_clause} "
                    "RETURN s.relation_id AS relation_id, "
                    "c.index_node_id AS index_node_id, c.document_id AS document_id",
                    dataset_id=self.dataset.id,
                    ids=relation_ids,
                    document_ids=document_ids,
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
