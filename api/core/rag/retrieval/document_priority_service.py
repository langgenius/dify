"""
Document Priority Service

Applies priority boosting to retrieved documents based on document names.
Fetches document names in bulk and adjusts document scores accordingly.
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.models.document import Document as RagDocument
from core.rag.retrieval.document_priority_loader import DocumentPriorityLoader
from extensions.ext_database import db
from models.dataset import Document as DatasetDocument

logger = logging.getLogger("dify.rag.priority")


class DocumentPriorityService:
    """Service for applying document priority boosts during retrieval"""

    @classmethod
    def apply_priority(cls, documents: list[RagDocument], dataset_id: str) -> list[RagDocument]:
        """
        Apply priority boost to documents based on document names.

        Args:
            documents: List of retrieved documents
            dataset_id: ID of the dataset

        Returns:
            Documents sorted by boosted scores (highest first)
        """
        if not documents:
            return documents

        logger.info("[PRIORITY] Starting priority boost for %s documents", len(documents))

        # Extract unique document IDs from metadata (using "document_id", not "doc_id")
        doc_ids = list({doc.metadata.get("document_id") for doc in documents if doc.metadata.get("document_id")})

        logger.info("[PRIORITY] Extracted %s unique document IDs", len(doc_ids))

        if not doc_ids:
            logger.warning("[PRIORITY] No document_id found in metadata, skipping priority boost")
            if documents:
                logger.warning("[PRIORITY] First doc metadata keys: %s", list(documents[0].metadata.keys()))
            return documents

        # Fetch document names from database in bulk
        doc_name_map = cls._fetch_document_names(doc_ids, dataset_id)
        logger.info("[PRIORITY] Fetched %s document names from database", len(doc_name_map))

        if not doc_name_map:
            logger.warning("[PRIORITY] No document names found in database")
            return documents

        # Apply priority boost
        boosted_count = 0
        for doc in documents:
            doc_id = doc.metadata.get("document_id")
            if not doc_id or doc_id not in doc_name_map:
                continue

            doc_name = doc_name_map[doc_id]
            boost = DocumentPriorityLoader.get_priority_boost(doc_name)

            if boost > 0:
                # Boost the score
                current_score = doc.metadata.get("score", 0.0)
                if isinstance(current_score, (int, float)):
                    new_score = current_score + boost
                    doc.metadata["score"] = new_score
                    doc.metadata["priority_boosted"] = True
                    doc.metadata["priority_boost_value"] = boost
                    doc.metadata["document_name"] = doc_name  # Add for debugging
                    boosted_count += 1
                    logger.info("[PRIORITY] Boosted '%s': %.4f → %.4f (+%s)", doc_name, current_score, new_score, boost)
                else:
                    logger.debug("[PRIORITY] '%s': score=%s (not numeric)", doc_name, current_score)
            else:
                logger.debug("[PRIORITY] '%s': boost=0 (no match)", doc_name)

        logger.info("[PRIORITY] Applied boost to %s/%s documents", boosted_count, len(documents))

        # Re-sort documents by score (descending)
        documents.sort(key=lambda d: d.metadata.get("score", 0.0), reverse=True)

        return documents

    @classmethod
    def _fetch_document_names(cls, doc_ids: list[str], dataset_id: str) -> dict[str, str]:
        """
        Fetch document names from database in bulk.

        Args:
            doc_ids: List of document IDs
            dataset_id: Dataset ID for filtering

        Returns:
            Dictionary mapping document ID to document name
        """
        if not doc_ids:
            return {}

        try:
            with Session(db.engine) as session:
                stmt = (
                    select(DatasetDocument.id, DatasetDocument.name)
                    .where(DatasetDocument.id.in_(doc_ids))
                    .where(DatasetDocument.dataset_id == dataset_id)
                )
                results = session.execute(stmt).all()
                result_map = {str(row.id): row.name for row in results if row.name}
                logger.info(
                    "[PRIORITY] Database query: %s IDs → %s rows → %s with names",
                    len(doc_ids),
                    len(results),
                    len(result_map),
                )
                if not result_map and doc_ids:
                    logger.warning(
                        "[PRIORITY] No names found for dataset_id=%s, sample doc_id=%s", dataset_id, doc_ids[0]
                    )
                return result_map
        except Exception as e:
            logger.error("[PRIORITY] Database query failed: %s", e, exc_info=True)
            return {}
