"""Builds and maintains the knowledge graph alongside the vector/keyword index."""

import logging

from sqlalchemy.orm import Session

from core.rag.datasource.graph.graph_base import GraphStats, StoredEntity, StoredRelation
from core.rag.datasource.graph.graph_factory import GraphStore
from core.rag.graph.entities import GraphIndexSetting
from core.rag.graph.entity_extractor import EntityRelationExtractor
from core.rag.models.document import Document
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class GraphIndexService:
    """Entry point used by the index processors to keep the graph in sync.

    Graph indexing is an enhancement layer over the regular index: a failure
    here is logged and swallowed so that a chunk stays searchable through vector
    and keyword retrieval even when extraction is unavailable.
    """

    @staticmethod
    def get_setting(dataset: Dataset) -> GraphIndexSetting | None:
        """Return the dataset's graph configuration, or ``None`` when disabled."""
        raw = dataset.graph_index_setting
        if not raw:
            return None
        try:
            setting = GraphIndexSetting.model_validate(raw)
        except Exception:
            logger.warning("Invalid graph_index_setting on dataset %s", dataset.id, exc_info=True)
            return None
        if not setting.enabled:
            return None
        if not setting.model_provider_name or not setting.model_name:
            logger.warning("Graph index enabled on dataset %s but no extraction model is configured", dataset.id)
            return None
        return setting

    @classmethod
    def build_for_documents(cls, dataset: Dataset, documents: list[Document], *, session: Session) -> None:
        """Extract and merge the subgraph for a batch of freshly indexed chunks."""
        setting = cls.get_setting(dataset)
        if not setting or not documents:
            return
        try:
            extractor = EntityRelationExtractor(tenant_id=dataset.tenant_id, setting=setting)
            chunk_graphs = extractor.extract_documents(documents)
            if not chunk_graphs:
                return
            GraphStore(dataset).add_chunk_graphs(chunk_graphs, session=session)
            logger.info(
                "Built knowledge graph for %s chunks in dataset %s",
                len(chunk_graphs),
                dataset.id,
            )
        except Exception:
            logger.exception("Failed to build the knowledge graph for dataset %s", dataset.id)

    @classmethod
    def delete_by_index_node_ids(cls, dataset: Dataset, index_node_ids: list[str], *, session: Session) -> None:
        """Drop graph facts sourced from the given chunks."""
        # Guard on the setting existing at all rather than on `enabled`, so that
        # turning the graph off does not strand rows that can never be cleaned.
        if not index_node_ids or not dataset.graph_index_setting:
            return
        try:
            GraphStore(dataset).delete_by_index_node_ids(index_node_ids, session=session)
        except Exception:
            logger.exception("Failed to clean the knowledge graph for dataset %s", dataset.id)

    @classmethod
    def delete_by_document_ids(cls, dataset: Dataset, document_ids: list[str], *, session: Session) -> None:
        """Drop graph facts sourced from the given documents."""
        if not document_ids or not dataset.graph_index_setting:
            return
        try:
            GraphStore(dataset).delete_by_document_ids(document_ids, session=session)
        except Exception:
            logger.exception("Failed to clean the knowledge graph for dataset %s", dataset.id)

    @classmethod
    def delete_all(cls, dataset: Dataset, *, session: Session) -> None:
        """Drop the entire graph for a dataset."""
        if not dataset.graph_index_setting:
            return
        try:
            GraphStore(dataset).delete(session=session)
        except Exception:
            logger.exception("Failed to delete the knowledge graph for dataset %s", dataset.id)

    @classmethod
    def get_stats(cls, dataset: Dataset, *, session: Session) -> GraphStats:
        """Return entity/relation counts for a dataset, or zeros when no graph exists."""
        if not dataset.graph_index_setting:
            return GraphStats()
        return GraphStore(dataset).stats(session=session)

    @classmethod
    def explore(
        cls,
        dataset: Dataset,
        query: str | None,
        limit: int,
        *,
        session: Session,
    ) -> tuple[list[StoredEntity], list[StoredRelation]]:
        """Return a subgraph around ``query`` for inspection in the console.

        With no query, returns the most frequently mentioned entities, which is
        a useful default view of what the extractor found.
        """
        if not dataset.graph_index_setting:
            return [], []

        from core.rag.graph.graph_retrieval import extract_query_keywords

        store = GraphStore(dataset)
        if query and query.strip():
            keywords = extract_query_keywords(query)
            entities = store.search_entities(keywords, limit, session=session) if keywords else []
        else:
            # No query: show the most frequently mentioned entities.
            entities = store.list_entities(limit, session=session)

        if not entities:
            return [], []

        entity_ids = [entity.id for entity in entities]
        relations = store.get_relations(entity_ids, limit * 4, session=session)

        # Include the far endpoints so the client can render every returned edge.
        known_ids = set(entity_ids)
        missing_ids = [
            endpoint
            for relation in relations
            for endpoint in (relation.source_entity_id, relation.target_entity_id)
            if endpoint not in known_ids
        ]
        if missing_ids:
            entities.extend(store.get_entities_by_ids(list(set(missing_ids)), session=session))
        return entities, relations
