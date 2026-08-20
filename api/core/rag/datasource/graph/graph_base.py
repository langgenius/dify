"""Abstract interface for knowledge-graph storage backends."""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.rag.graph.entities import ChunkGraph
from models.dataset import Dataset


class StoredEntity(BaseModel):
    """A persisted graph node, backend-agnostic."""

    id: str
    name: str
    display_name: str
    entity_type: str
    description: str = ""
    frequency: int = 1


class StoredRelation(BaseModel):
    """A persisted graph edge, backend-agnostic."""

    id: str
    source_entity_id: str
    target_entity_id: str
    predicate: str
    description: str = ""
    weight: float = 1.0


class StoredChunkLink(BaseModel):
    """Provenance of a node or edge, used to turn graph hits into citations."""

    index_node_id: str
    document_id: str
    entity_id: str | None = None
    relation_id: str | None = None


class GraphStats(BaseModel):
    """Summary of a dataset's graph, surfaced through the console API."""

    entity_count: int = 0
    relation_count: int = 0
    entity_types: dict[str, int] = Field(default_factory=dict)


class BaseGraphStore(ABC):
    """Storage contract for a dataset's knowledge graph.

    Backends receive a SQLAlchemy ``session`` on every call to match the
    convention used by the keyword store; backends that do not persist into the
    metadata database are free to ignore it.
    """

    def __init__(self, dataset: Dataset):
        self.dataset = dataset

    @abstractmethod
    def add_chunk_graphs(self, chunk_graphs: list[ChunkGraph], *, session: Session) -> None:
        """Merge per-chunk extractions into the dataset graph."""
        raise NotImplementedError

    @abstractmethod
    def delete_by_document_ids(self, document_ids: list[str], *, session: Session) -> None:
        """Remove all facts sourced from the given documents, pruning orphans."""
        raise NotImplementedError

    @abstractmethod
    def delete_by_index_node_ids(self, index_node_ids: list[str], *, session: Session) -> None:
        """Remove all facts sourced from the given chunks, pruning orphans."""
        raise NotImplementedError

    @abstractmethod
    def delete(self, *, session: Session) -> None:
        """Drop the whole graph for this dataset."""
        raise NotImplementedError

    @abstractmethod
    def get_entities_by_names(self, names: list[str], *, session: Session) -> list[StoredEntity]:
        """Look up entities by their normalized names."""
        raise NotImplementedError

    @abstractmethod
    def search_entities(self, keywords: list[str], limit: int, *, session: Session) -> list[StoredEntity]:
        """Find entities whose name partially matches any keyword, most frequent first."""
        raise NotImplementedError

    @abstractmethod
    def get_relations(self, entity_ids: list[str], limit: int, *, session: Session) -> list[StoredRelation]:
        """Return edges incident to any of ``entity_ids``, in either direction."""
        raise NotImplementedError

    @abstractmethod
    def get_entities_by_ids(self, entity_ids: list[str], *, session: Session) -> list[StoredEntity]:
        raise NotImplementedError

    @abstractmethod
    def list_entities(self, limit: int, *, session: Session) -> list[StoredEntity]:
        """Return the most frequently mentioned entities, for console inspection."""
        raise NotImplementedError

    @abstractmethod
    def get_chunk_links(
        self,
        entity_ids: list[str],
        relation_ids: list[str],
        *,
        session: Session,
    ) -> list[StoredChunkLink]:
        """Return the chunks that support the given nodes and edges."""
        raise NotImplementedError

    @abstractmethod
    def stats(self, *, session: Session) -> GraphStats:
        raise NotImplementedError
