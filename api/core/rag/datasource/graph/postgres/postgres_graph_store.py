"""Knowledge-graph backend stored in Dify's own metadata database.

This is the default backend: it needs no extra service, inherits tenant
isolation and backups from the existing database, and lets graph hits join
straight back to ``document_segments`` for citations.
"""

import logging
from dataclasses import dataclass
from typing import override

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from core.rag.datasource.graph.graph_base import (
    BaseGraphStore,
    GraphStats,
    StoredChunkLink,
    StoredEntity,
    StoredRelation,
)
from core.rag.graph.entities import UNKNOWN_ENTITY_TYPE, ChunkGraph
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DatasetGraphChunkLink, DatasetGraphEntity, DatasetGraphRelation

logger = logging.getLogger(__name__)

# Descriptions accumulate across chunks; cap them so a popular entity cannot
# grow without bound.
MAX_MERGED_DESCRIPTION_LENGTH = 4000

# SQLite (used by some test setups) caps bound parameters, so chunk large IN lists.
_ID_CHUNK_SIZE = 500


@dataclass
class _MergedEntity:
    """An entity collapsed across the chunks of a single indexing batch."""

    display_name: str
    entity_type: str
    description: str
    count: int


@dataclass
class _MergedRelation:
    """A relation collapsed across the chunks of a single indexing batch."""

    description: str
    count: int


class PostgresGraphStore(BaseGraphStore):
    def __init__(self, dataset: Dataset):
        super().__init__(dataset)

    @override
    def add_chunk_graphs(self, chunk_graphs: list[ChunkGraph], *, session: Session) -> None:
        if not chunk_graphs:
            return

        # Documents of the same dataset can be indexed in parallel; serialize the
        # read-modify-write merge so concurrent workers cannot both insert the
        # same entity and trip the unique constraint.
        lock_name = f"graph_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            entity_ids = self._merge_entities(chunk_graphs, session=session)
            relation_ids = self._merge_relations(chunk_graphs, entity_ids, session=session)
            self._merge_chunk_links(chunk_graphs, entity_ids, relation_ids, session=session)
            session.flush()

    def _merge_entities(self, chunk_graphs: list[ChunkGraph], *, session: Session) -> dict[str, str]:
        """Upsert every extracted entity and return a normalized-name -> id map."""
        incoming = self._collapse_entities(chunk_graphs)
        if not incoming:
            return {}

        existing_rows = self._fetch_entities_by_names(list(incoming), session=session)
        existing_by_name = {row.name: row for row in existing_rows}

        name_to_id: dict[str, str] = {}
        for name, merged in incoming.items():
            row = existing_by_name.get(name)
            if row is None:
                row = DatasetGraphEntity(
                    tenant_id=self.dataset.tenant_id,
                    dataset_id=self.dataset.id,
                    name=name,
                    display_name=merged.display_name or name,
                    entity_type=merged.entity_type or UNKNOWN_ENTITY_TYPE,
                    description=merged.description or None,
                    frequency=merged.count,
                )
                session.add(row)
                session.flush()
            else:
                row.frequency += merged.count
                if row.entity_type == UNKNOWN_ENTITY_TYPE and merged.entity_type != UNKNOWN_ENTITY_TYPE:
                    row.entity_type = merged.entity_type
                row.description = self._merge_description(row.description, merged.description)
            name_to_id[name] = row.id
        return name_to_id

    @classmethod
    def _collapse_entities(cls, chunk_graphs: list[ChunkGraph]) -> dict[str, "_MergedEntity"]:
        """Collapse a batch's entities by name, accumulating descriptions.

        Uses the same append-based description merge as the cross-batch path, so
        an entity mentioned twice in one indexing run keeps as much context as
        one mentioned across two runs. Extraction results are never mutated.
        """
        merged: dict[str, _MergedEntity] = {}
        for chunk_graph in chunk_graphs:
            for entity in chunk_graph.extraction.entities:
                current = merged.get(entity.name)
                if current is None:
                    merged[entity.name] = _MergedEntity(
                        display_name=entity.display_name,
                        entity_type=entity.entity_type or UNKNOWN_ENTITY_TYPE,
                        description=entity.description,
                        count=1,
                    )
                    continue
                current.count += 1
                if current.entity_type == UNKNOWN_ENTITY_TYPE and entity.entity_type != UNKNOWN_ENTITY_TYPE:
                    current.entity_type = entity.entity_type
                current.description = cls._merge_description(current.description, entity.description) or ""
        return merged

    def _merge_relations(
        self,
        chunk_graphs: list[ChunkGraph],
        entity_ids: dict[str, str],
        *,
        session: Session,
    ) -> dict[tuple[str, str, str], str]:
        """Upsert every extracted relation, keyed by (source, target, predicate)."""
        incoming: dict[tuple[str, str, str], _MergedRelation] = {}
        for chunk_graph in chunk_graphs:
            for relation in chunk_graph.extraction.relations:
                source_id = entity_ids.get(relation.source)
                target_id = entity_ids.get(relation.target)
                if not source_id or not target_id:
                    continue
                key = (source_id, target_id, relation.predicate)
                current = incoming.get(key)
                if current is None:
                    incoming[key] = _MergedRelation(description=relation.description, count=1)
                    continue
                current.count += 1
                current.description = self._merge_description(current.description, relation.description) or ""

        if not incoming:
            return {}

        source_ids = {key[0] for key in incoming}
        existing_rows = self._fetch_relations_by_source_ids(list(source_ids), session=session)
        existing_by_key = {(row.source_entity_id, row.target_entity_id, row.predicate): row for row in existing_rows}

        key_to_id: dict[tuple[str, str, str], str] = {}
        for key, merged in incoming.items():
            row = existing_by_key.get(key)
            if row is None:
                row = DatasetGraphRelation(
                    tenant_id=self.dataset.tenant_id,
                    dataset_id=self.dataset.id,
                    source_entity_id=key[0],
                    target_entity_id=key[1],
                    predicate=key[2],
                    description=merged.description or None,
                    weight=float(merged.count),
                )
                session.add(row)
                session.flush()
            else:
                row.weight += float(merged.count)
                row.description = self._merge_description(row.description, merged.description)
            key_to_id[key] = row.id
        return key_to_id

    def _merge_chunk_links(
        self,
        chunk_graphs: list[ChunkGraph],
        entity_ids: dict[str, str],
        relation_ids: dict[tuple[str, str, str], str],
        *,
        session: Session,
    ) -> None:
        """Record which chunk each node and edge came from.

        Links for the incoming chunks are cleared first so re-indexing a document
        replaces its provenance instead of duplicating it.
        """
        index_node_ids = [chunk_graph.index_node_id for chunk_graph in chunk_graphs]
        self._delete_links_by_index_node_ids(index_node_ids, session=session)

        seen: set[tuple[str, str | None, str | None]] = set()
        for chunk_graph in chunk_graphs:
            for entity in chunk_graph.extraction.entities:
                entity_id = entity_ids.get(entity.name)
                if not entity_id:
                    continue
                key = (chunk_graph.index_node_id, entity_id, None)
                if key in seen:
                    continue
                seen.add(key)
                session.add(
                    DatasetGraphChunkLink(
                        tenant_id=self.dataset.tenant_id,
                        dataset_id=self.dataset.id,
                        document_id=chunk_graph.document_id,
                        index_node_id=chunk_graph.index_node_id,
                        entity_id=entity_id,
                    )
                )
            for relation in chunk_graph.extraction.relations:
                source_id = entity_ids.get(relation.source)
                target_id = entity_ids.get(relation.target)
                if not source_id or not target_id:
                    continue
                relation_id = relation_ids.get((source_id, target_id, relation.predicate))
                if not relation_id:
                    continue
                key = (chunk_graph.index_node_id, None, relation_id)
                if key in seen:
                    continue
                seen.add(key)
                session.add(
                    DatasetGraphChunkLink(
                        tenant_id=self.dataset.tenant_id,
                        dataset_id=self.dataset.id,
                        document_id=chunk_graph.document_id,
                        index_node_id=chunk_graph.index_node_id,
                        relation_id=relation_id,
                    )
                )

    @override
    def delete_by_document_ids(self, document_ids: list[str], *, session: Session) -> None:
        if not document_ids:
            return
        for batch in _batched(document_ids):
            session.execute(
                delete(DatasetGraphChunkLink).where(
                    DatasetGraphChunkLink.dataset_id == self.dataset.id,
                    DatasetGraphChunkLink.document_id.in_(batch),
                )
            )
        self._prune_orphans(session=session)

    @override
    def delete_by_index_node_ids(self, index_node_ids: list[str], *, session: Session) -> None:
        if not index_node_ids:
            return
        self._delete_links_by_index_node_ids(index_node_ids, session=session)
        self._prune_orphans(session=session)

    @override
    def delete(self, *, session: Session) -> None:
        session.execute(delete(DatasetGraphChunkLink).where(DatasetGraphChunkLink.dataset_id == self.dataset.id))
        session.execute(delete(DatasetGraphRelation).where(DatasetGraphRelation.dataset_id == self.dataset.id))
        session.execute(delete(DatasetGraphEntity).where(DatasetGraphEntity.dataset_id == self.dataset.id))
        session.flush()

    def _delete_links_by_index_node_ids(self, index_node_ids: list[str], *, session: Session) -> None:
        for batch in _batched(index_node_ids):
            session.execute(
                delete(DatasetGraphChunkLink).where(
                    DatasetGraphChunkLink.dataset_id == self.dataset.id,
                    DatasetGraphChunkLink.index_node_id.in_(batch),
                )
            )

    def _prune_orphans(self, *, session: Session) -> None:
        """Delete nodes and edges that no surviving chunk supports.

        Relations are pruned first so an edge whose endpoints disappear cannot be
        left dangling.
        """
        session.flush()
        linked_relation_ids = select(DatasetGraphChunkLink.relation_id).where(
            DatasetGraphChunkLink.dataset_id == self.dataset.id,
            DatasetGraphChunkLink.relation_id.is_not(None),
        )
        session.execute(
            delete(DatasetGraphRelation).where(
                DatasetGraphRelation.dataset_id == self.dataset.id,
                DatasetGraphRelation.id.not_in(linked_relation_ids),
            )
        )
        linked_entity_ids = select(DatasetGraphChunkLink.entity_id).where(
            DatasetGraphChunkLink.dataset_id == self.dataset.id,
            DatasetGraphChunkLink.entity_id.is_not(None),
        )
        session.execute(
            delete(DatasetGraphEntity).where(
                DatasetGraphEntity.dataset_id == self.dataset.id,
                DatasetGraphEntity.id.not_in(linked_entity_ids),
            )
        )
        # Drop edges left dangling by the entity prune above.
        surviving_entity_ids = select(DatasetGraphEntity.id).where(DatasetGraphEntity.dataset_id == self.dataset.id)
        session.execute(
            delete(DatasetGraphRelation).where(
                DatasetGraphRelation.dataset_id == self.dataset.id,
                or_(
                    DatasetGraphRelation.source_entity_id.not_in(surviving_entity_ids),
                    DatasetGraphRelation.target_entity_id.not_in(surviving_entity_ids),
                ),
            )
        )
        session.flush()

    @override
    def get_entities_by_names(self, names: list[str], *, session: Session) -> list[StoredEntity]:
        return [self._to_entity(row) for row in self._fetch_entities_by_names(names, session=session)]

    @override
    def search_entities(self, keywords: list[str], limit: int, *, session: Session) -> list[StoredEntity]:
        cleaned = [keyword for keyword in (k.strip() for k in keywords) if keyword]
        if not cleaned:
            return []
        # Names are stored case-folded, so a plain LIKE is already case-insensitive.
        conditions = [DatasetGraphEntity.name.like(f"%{_escape_like(keyword)}%", escape="\\") for keyword in cleaned]
        rows = session.scalars(
            select(DatasetGraphEntity)
            .where(DatasetGraphEntity.dataset_id == self.dataset.id, or_(*conditions))
            .order_by(DatasetGraphEntity.frequency.desc())
            .limit(limit)
        ).all()
        return [self._to_entity(row) for row in rows]

    @override
    def get_entities_by_ids(self, entity_ids: list[str], *, session: Session) -> list[StoredEntity]:
        if not entity_ids:
            return []
        rows: list[DatasetGraphEntity] = []
        for batch in _batched(entity_ids):
            rows.extend(
                session.scalars(
                    select(DatasetGraphEntity).where(
                        DatasetGraphEntity.dataset_id == self.dataset.id,
                        DatasetGraphEntity.id.in_(batch),
                    )
                ).all()
            )
        return [self._to_entity(row) for row in rows]

    @override
    def list_entities(self, limit: int, *, session: Session) -> list[StoredEntity]:
        rows = session.scalars(
            select(DatasetGraphEntity)
            .where(DatasetGraphEntity.dataset_id == self.dataset.id)
            .order_by(DatasetGraphEntity.frequency.desc())
            .limit(limit)
        ).all()
        return [self._to_entity(row) for row in rows]

    @override
    def get_relations(self, entity_ids: list[str], limit: int, *, session: Session) -> list[StoredRelation]:
        if not entity_ids:
            return []
        rows: list[DatasetGraphRelation] = []
        for batch in _batched(entity_ids):
            rows.extend(
                session.scalars(
                    select(DatasetGraphRelation)
                    .where(
                        DatasetGraphRelation.dataset_id == self.dataset.id,
                        or_(
                            DatasetGraphRelation.source_entity_id.in_(batch),
                            DatasetGraphRelation.target_entity_id.in_(batch),
                        ),
                    )
                    .order_by(DatasetGraphRelation.weight.desc())
                    .limit(limit)
                ).all()
            )
        # Batching can exceed the caller's budget; keep the strongest edges.
        rows.sort(key=lambda row: row.weight, reverse=True)
        return [self._to_relation(row) for row in rows[:limit]]

    @override
    def get_chunk_links(
        self,
        entity_ids: list[str],
        relation_ids: list[str],
        *,
        session: Session,
    ) -> list[StoredChunkLink]:
        links: list[StoredChunkLink] = []
        for batch in _batched(entity_ids):
            rows = session.scalars(
                select(DatasetGraphChunkLink).where(
                    DatasetGraphChunkLink.dataset_id == self.dataset.id,
                    DatasetGraphChunkLink.entity_id.in_(batch),
                )
            ).all()
            links.extend(self._to_link(row) for row in rows)
        for batch in _batched(relation_ids):
            rows = session.scalars(
                select(DatasetGraphChunkLink).where(
                    DatasetGraphChunkLink.dataset_id == self.dataset.id,
                    DatasetGraphChunkLink.relation_id.in_(batch),
                )
            ).all()
            links.extend(self._to_link(row) for row in rows)
        return links

    @override
    def stats(self, *, session: Session) -> GraphStats:
        entity_count = (
            session.scalar(
                select(func.count(DatasetGraphEntity.id)).where(DatasetGraphEntity.dataset_id == self.dataset.id)
            )
            or 0
        )
        relation_count = (
            session.scalar(
                select(func.count(DatasetGraphRelation.id)).where(DatasetGraphRelation.dataset_id == self.dataset.id)
            )
            or 0
        )
        type_rows = session.execute(
            select(DatasetGraphEntity.entity_type, func.count(DatasetGraphEntity.id))
            .where(DatasetGraphEntity.dataset_id == self.dataset.id)
            .group_by(DatasetGraphEntity.entity_type)
        ).all()
        return GraphStats(
            entity_count=entity_count,
            relation_count=relation_count,
            entity_types={row[0]: row[1] for row in type_rows},
        )

    def _fetch_entities_by_names(self, names: list[str], *, session: Session) -> list[DatasetGraphEntity]:
        if not names:
            return []
        rows: list[DatasetGraphEntity] = []
        for batch in _batched(names):
            rows.extend(
                session.scalars(
                    select(DatasetGraphEntity).where(
                        DatasetGraphEntity.dataset_id == self.dataset.id,
                        DatasetGraphEntity.name.in_(batch),
                    )
                ).all()
            )
        return rows

    def _fetch_relations_by_source_ids(self, source_ids: list[str], *, session: Session) -> list[DatasetGraphRelation]:
        rows: list[DatasetGraphRelation] = []
        for batch in _batched(source_ids):
            rows.extend(
                session.scalars(
                    select(DatasetGraphRelation).where(
                        DatasetGraphRelation.dataset_id == self.dataset.id,
                        DatasetGraphRelation.source_entity_id.in_(batch),
                    )
                ).all()
            )
        return rows

    @staticmethod
    def _merge_description(existing: str | None, incoming: str) -> str | None:
        if not incoming:
            return existing
        if not existing:
            return incoming[:MAX_MERGED_DESCRIPTION_LENGTH]
        if incoming in existing:
            return existing
        merged = f"{existing}\n{incoming}"
        return merged[:MAX_MERGED_DESCRIPTION_LENGTH]

    @staticmethod
    def _to_entity(row: DatasetGraphEntity) -> StoredEntity:
        return StoredEntity(
            id=row.id,
            name=row.name,
            display_name=row.display_name,
            entity_type=row.entity_type,
            description=row.description or "",
            frequency=row.frequency,
        )

    @staticmethod
    def _to_relation(row: DatasetGraphRelation) -> StoredRelation:
        return StoredRelation(
            id=row.id,
            source_entity_id=row.source_entity_id,
            target_entity_id=row.target_entity_id,
            predicate=row.predicate,
            description=row.description or "",
            weight=row.weight,
        )

    @staticmethod
    def _to_link(row: DatasetGraphChunkLink) -> StoredChunkLink:
        return StoredChunkLink(
            index_node_id=row.index_node_id,
            document_id=row.document_id,
            entity_id=row.entity_id,
            relation_id=row.relation_id,
        )


def _batched(values: list[str]) -> list[list[str]]:
    if not values:
        return []
    return [values[i : i + _ID_CHUNK_SIZE] for i in range(0, len(values), _ID_CHUNK_SIZE)]


def _escape_like(value: str) -> str:
    """Escape LIKE wildcards so a query term is matched literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
