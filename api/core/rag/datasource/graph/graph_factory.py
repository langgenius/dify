"""Factory selecting the configured knowledge-graph backend."""

from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.datasource.graph.graph_base import (
    BaseGraphStore,
    GraphStats,
    StoredChunkLink,
    StoredEntity,
    StoredRelation,
)
from core.rag.datasource.graph.graph_type import GraphStoreType
from core.rag.graph.entities import ChunkGraph
from models.dataset import Dataset


class GraphStore:
    """Thin facade over the configured :class:`BaseGraphStore` implementation.

    Mirrors the shape of :class:`core.rag.datasource.keyword.keyword_factory.Keyword`
    so calling code does not care which backend is configured.
    """

    def __init__(self, dataset: Dataset):
        self._dataset = dataset
        self._store = self._init_store()

    def _init_store(self) -> BaseGraphStore:
        store_type = dify_config.GRAPH_STORE
        store_factory = self.get_graph_factory(store_type)
        return store_factory(self._dataset)

    @staticmethod
    def get_graph_factory(store_type: str) -> type[BaseGraphStore]:
        match store_type:
            case GraphStoreType.POSTGRES:
                from core.rag.datasource.graph.postgres.postgres_graph_store import PostgresGraphStore

                return PostgresGraphStore
            case GraphStoreType.NEO4J:
                from core.rag.datasource.graph.neo4j.neo4j_graph_store import Neo4jGraphStore

                return Neo4jGraphStore
            case _:
                raise ValueError(f"Graph store {store_type} is not supported.")

    def add_chunk_graphs(self, chunk_graphs: list[ChunkGraph], *, session: Session) -> None:
        self._store.add_chunk_graphs(chunk_graphs, session=session)

    def delete_by_document_ids(self, document_ids: list[str], *, session: Session) -> None:
        self._store.delete_by_document_ids(document_ids, session=session)

    def delete_by_index_node_ids(self, index_node_ids: list[str], *, session: Session) -> None:
        self._store.delete_by_index_node_ids(index_node_ids, session=session)

    def delete(self, *, session: Session) -> None:
        self._store.delete(session=session)

    def get_entities_by_names(self, names: list[str], *, session: Session) -> list[StoredEntity]:
        return self._store.get_entities_by_names(names, session=session)

    def search_entities(self, keywords: list[str], limit: int, *, session: Session) -> list[StoredEntity]:
        return self._store.search_entities(keywords, limit, session=session)

    def get_entities_by_ids(self, entity_ids: list[str], *, session: Session) -> list[StoredEntity]:
        return self._store.get_entities_by_ids(entity_ids, session=session)

    def list_entities(self, limit: int, *, session: Session) -> list[StoredEntity]:
        return self._store.list_entities(limit, session=session)

    def get_relations(self, entity_ids: list[str], limit: int, *, session: Session) -> list[StoredRelation]:
        return self._store.get_relations(entity_ids, limit, session=session)

    def get_chunk_links(
        self,
        entity_ids: list[str],
        relation_ids: list[str],
        *,
        session: Session,
    ) -> list[StoredChunkLink]:
        return self._store.get_chunk_links(entity_ids, relation_ids, session=session)

    def stats(self, *, session: Session) -> GraphStats:
        return self._store.stats(session=session)
