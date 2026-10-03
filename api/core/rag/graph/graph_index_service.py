"""Builds and maintains the knowledge graph alongside the vector/keyword index."""

import logging

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.rag.datasource.graph.graph_base import GraphStats, StoredEntity, StoredRelation
from core.rag.datasource.graph.graph_factory import GraphStore
from core.rag.graph.entities import ChunkExtractionBatch, ChunkExtractionFailure, GraphIndexSetting
from core.rag.graph.entity_extractor import EntityRelationExtractor, describe_extraction_error
from core.rag.models.document import Document
from models.dataset import (
    Dataset,
    DatasetGraphChunkLink,
    DatasetGraphEntity,
    DatasetGraphExtractionFailure,
    DatasetGraphRelation,
)

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
            batch = extractor.extract_documents(documents)
        except Exception as error:
            logger.exception("Failed to extract the knowledge graph for dataset %s", dataset.id)
            batch = ChunkExtractionBatch(failures=cls._fail_all(documents, error))
        if batch.graphs:
            try:
                GraphStore(dataset).add_chunk_graphs(batch.graphs, session=session)
                logger.info(
                    "Built knowledge graph for %s chunks in dataset %s",
                    len(batch.graphs),
                    dataset.id,
                )
            except Exception:
                logger.exception("Failed to build the knowledge graph for dataset %s", dataset.id)
        cls._record_extraction_outcome(dataset, batch)

    @staticmethod
    def _fail_all(documents: list[Document], error: Exception) -> list[ChunkExtractionFailure]:
        reason = describe_extraction_error(error)
        failures: list[ChunkExtractionFailure] = []
        for document in documents:
            metadata = document.metadata or {}
            if metadata.get("doc_id") and metadata.get("document_id"):
                failures.append(
                    ChunkExtractionFailure(
                        index_node_id=str(metadata["doc_id"]),
                        document_id=str(metadata["document_id"]),
                        error=reason,
                    )
                )
        return failures

    @staticmethod
    def _record_extraction_outcome(dataset: Dataset, batch: ChunkExtractionBatch) -> None:
        """Replace the failure records of every chunk this batch attempted.

        Runs in its own short transaction rather than the caller's: these rows
        only explain the graph to the console, so a conflict here must never
        roll back the indexing write that called us.
        """
        attempted = [*batch.succeeded, *(failure.index_node_id for failure in batch.failures)]
        if not attempted:
            return
        try:
            with session_factory.create_session() as session, session.begin():
                session.execute(
                    delete(DatasetGraphExtractionFailure).where(
                        DatasetGraphExtractionFailure.dataset_id == dataset.id,
                        DatasetGraphExtractionFailure.index_node_id.in_(attempted),
                    )
                )
                session.add_all(
                    [
                        DatasetGraphExtractionFailure(
                            tenant_id=dataset.tenant_id,
                            dataset_id=dataset.id,
                            document_id=failure.document_id,
                            index_node_id=failure.index_node_id,
                            error=failure.error,
                        )
                        for failure in batch.failures
                    ]
                )
        except Exception:
            logger.exception("Failed to record knowledge graph extraction failures for dataset %s", dataset.id)

    @classmethod
    def delete_by_index_node_ids(cls, dataset: Dataset, index_node_ids: list[str], *, session: Session) -> None:
        """Drop graph facts sourced from the given chunks."""
        # Guard on the setting existing at all rather than on `enabled`, so that
        # turning the graph off does not strand rows that can never be cleaned.
        if not index_node_ids or not dataset.graph_index_setting:
            return
        try:
            session.execute(
                delete(DatasetGraphExtractionFailure).where(
                    DatasetGraphExtractionFailure.dataset_id == dataset.id,
                    DatasetGraphExtractionFailure.index_node_id.in_(index_node_ids),
                )
            )
            GraphStore(dataset).delete_by_index_node_ids(index_node_ids, session=session)
        except Exception:
            logger.exception("Failed to clean the knowledge graph for dataset %s", dataset.id)

    @classmethod
    def delete_by_document_ids(cls, dataset: Dataset, document_ids: list[str], *, session: Session) -> None:
        """Drop graph facts sourced from the given documents."""
        if not document_ids or not dataset.graph_index_setting:
            return
        try:
            session.execute(
                delete(DatasetGraphExtractionFailure).where(
                    DatasetGraphExtractionFailure.dataset_id == dataset.id,
                    DatasetGraphExtractionFailure.document_id.in_(document_ids),
                )
            )
            GraphStore(dataset).delete_by_document_ids(document_ids, session=session)
        except Exception:
            logger.exception("Failed to clean the knowledge graph for dataset %s", dataset.id)

    @classmethod
    def delete_all(cls, dataset: Dataset, *, session: Session) -> None:
        """Drop the entire graph for a dataset."""
        if not dataset.graph_index_setting:
            return
        try:
            session.execute(
                delete(DatasetGraphExtractionFailure).where(DatasetGraphExtractionFailure.dataset_id == dataset.id)
            )
            GraphStore(dataset).delete(session=session)
        except Exception:
            logger.exception("Failed to delete the knowledge graph for dataset %s", dataset.id)

    @classmethod
    def purge_dataset(cls, dataset: Dataset, *, session: Session) -> None:
        """Drop every graph row for a dataset, whatever its settings say.

        Used by dataset deletion, where the settings-based guards used elsewhere
        are the wrong contract: a dataset whose ``graph_index_setting`` was
        cleared (or never reached the deletion task) would silently keep its
        entities, relations and provenance links forever.

        The metadata tables are cleared directly as well as through the
        configured backend, because a deployment can switch ``GRAPH_STORE``
        after indexing and the backend in force today is not necessarily the one
        that wrote yesterday's rows.
        """
        for model in (DatasetGraphChunkLink, DatasetGraphRelation, DatasetGraphEntity, DatasetGraphExtractionFailure):
            try:
                session.execute(delete(model).where(model.dataset_id == dataset.id))
            except Exception:
                logger.exception("Failed to delete %s rows for dataset %s", model.__tablename__, dataset.id)
        try:
            GraphStore(dataset).delete(session=session)
        except Exception:
            logger.exception("Failed to delete the knowledge graph for dataset %s", dataset.id)

    @staticmethod
    def is_enabled(dataset: Dataset) -> bool:
        """Whether the console should expose the graph for this dataset.

        Deliberately weaker than :meth:`get_setting`, which also requires an
        extraction model: an existing graph stays inspectable while its model is
        being reconfigured. Turning the feature off, however, hides it
        everywhere -- the API must not keep serving stale graph data after the UI
        has stopped offering it.
        """
        return dataset.graph_index_enabled

    @classmethod
    def get_stats(cls, dataset: Dataset, *, session: Session) -> GraphStats:
        """Return entity/relation counts and extraction failures, or zeros when no graph exists.

        The failure summary is what lets the console tell an empty graph apart
        from one the model could not build.
        """
        if not cls.is_enabled(dataset):
            return GraphStats()
        stats = GraphStore(dataset).stats(session=session)
        failed_chunk_count, last_failed_at = session.execute(
            select(func.count(), func.max(DatasetGraphExtractionFailure.created_at)).where(
                DatasetGraphExtractionFailure.dataset_id == dataset.id
            )
        ).one()
        if not failed_chunk_count:
            return stats
        last_error = session.scalar(
            select(DatasetGraphExtractionFailure.error)
            .where(DatasetGraphExtractionFailure.dataset_id == dataset.id)
            .order_by(DatasetGraphExtractionFailure.created_at.desc(), DatasetGraphExtractionFailure.id.desc())
            .limit(1)
        )
        return stats.model_copy(
            update={
                "failed_chunk_count": failed_chunk_count,
                "last_error": last_error,
                "last_failed_at": last_failed_at,
            }
        )

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
        if not cls.is_enabled(dataset):
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
