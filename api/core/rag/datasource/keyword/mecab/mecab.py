import json
import logging
import os
from collections import defaultdict
from typing import Any, Optional

from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.datasource.keyword.mecab.config import MeCabConfig
from core.rag.datasource.keyword.mecab.mecab_keyword_table_handler import MeCabKeywordTableHandler
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment

logger = logging.getLogger(__name__)


class KeywordProcessorError(Exception):
    """Base error for keyword processing."""

    pass


class KeywordExtractionError(KeywordProcessorError):
    """Error during keyword extraction."""

    pass


class KeywordStorageError(KeywordProcessorError):
    """Error during storage operations."""

    pass


class SetEncoder(json.JSONEncoder):
    """JSON encoder that handles sets."""

    def default(self, obj):
        if isinstance(obj, set):
            return list(obj)
        return super().default(obj)


class MeCab(BaseKeyword):
    """Japanese keyword processor using MeCab morphological analyzer."""

    def __init__(self, dataset: Dataset):
        super().__init__(dataset)
        self._config = MeCabConfig()
        self._keyword_handler: MeCabKeywordTableHandler = MeCabKeywordTableHandler()
        self._init_handler()

    def _init_handler(self) -> None:
        """Initialize MeCab handler with configuration."""
        try:
            self._keyword_handler = MeCabKeywordTableHandler(
                dictionary_path=self._config.dictionary_path, user_dictionary_path=self._config.user_dictionary_path
            )
            if self._config.pos_weights:
                self._keyword_handler.pos_weights = self._config.pos_weights
                self._keyword_handler.min_score = self._config.score_threshold
        except Exception as e:
            logger.exception("Failed to initialize MeCab handler")
            raise KeywordProcessorError("MeCab initialization failed: {}".format(str(e)))

    def create(self, texts: list[Document], **kwargs: Any) -> BaseKeyword:
        """Create keyword index for documents.

        Args:
            texts: List of documents to index
            **kwargs: Additional arguments

        Returns:
            BaseKeyword: Self for method chaining

        Raises:
            KeywordProcessorError: If indexing fails
            KeywordExtractionError: If keyword extraction fails
            KeywordStorageError: If storage operations fail
        """
        if not texts:
            return self

        lock_name = "keyword_indexing_lock_{}".format(self.dataset.id)
        try:
            with redis_client.lock(lock_name, timeout=600):
                keyword_table = self._get_dataset_keyword_table()
                if keyword_table is None:
                    keyword_table = {}

                for text in texts:
                    if not text.page_content or not text.metadata or "doc_id" not in text.metadata:
                        logger.warning("Skipping invalid document: {}".format(text))
                        continue

                    try:
                        keywords = self._keyword_handler.extract_keywords(
                            text.page_content, self._config.max_keywords_per_chunk
                        )
                        self._update_segment_keywords(self.dataset.id, text.metadata["doc_id"], list(keywords))
                        keyword_table = self._add_text_to_keyword_table(
                            keyword_table, text.metadata["doc_id"], list(keywords)
                        )
                    except Exception as e:
                        logger.exception("Failed to process document: {}".format(text.metadata.get("doc_id")))
                        raise KeywordExtractionError("Failed to extract keywords: {}".format(str(e)))

                try:
                    self._save_dataset_keyword_table(keyword_table)
                except Exception as e:
                    logger.exception("Failed to save keyword table")
                    raise KeywordStorageError("Failed to save keyword table: {}".format(str(e)))

        except Exception as e:
            if not isinstance(e, (KeywordExtractionError, KeywordStorageError)):
                logger.exception("Unexpected error during keyword indexing")
                raise KeywordProcessorError("Keyword indexing failed: {}".format(str(e)))
            raise

        return self

    def add_texts(self, texts: list[Document], **kwargs: Any) -> None:
        """Add new texts to existing index.

        Args:
            texts: List of documents to add
            **kwargs: Additional arguments including optional keywords_list

        Raises:
            KeywordProcessorError: If indexing fails
            KeywordStorageError: If storage operations fail
        """
        if not texts:
            return

        lock_name = "keyword_indexing_lock_{}".format(self.dataset.id)
        try:
            with redis_client.lock(lock_name, timeout=600):
                keyword_table = self._get_dataset_keyword_table()
                if keyword_table is None:
                    keyword_table = {}
                keywords_list = kwargs.get("keywords_list")

                for i, text in enumerate(texts):
                    if not text.page_content or not text.metadata or "doc_id" not in text.metadata:
                        logger.warning("Skipping invalid document: {}".format(text))
                        continue

                    try:
                        if keywords_list:
                            keywords = keywords_list[i]
                            if not keywords:
                                keywords = self._keyword_handler.extract_keywords(
                                    text.page_content, self._config.max_keywords_per_chunk
                                )
                        else:
                            keywords = self._keyword_handler.extract_keywords(
                                text.page_content, self._config.max_keywords_per_chunk
                            )

                        self._update_segment_keywords(self.dataset.id, text.metadata["doc_id"], list(keywords))
                        keyword_table = self._add_text_to_keyword_table(
                            keyword_table, text.metadata["doc_id"], list(keywords)
                        )
                    except Exception as e:
                        logger.exception("Failed to process document: {}".format(text.metadata.get("doc_id")))
                        continue

                try:
                    self._save_dataset_keyword_table(keyword_table)
                except Exception as e:
                    logger.exception("Failed to save keyword table")
                    raise KeywordStorageError("Failed to save keyword table: {}".format(str(e)))

        except Exception as e:
            if not isinstance(e, KeywordStorageError):
                logger.exception("Unexpected error during keyword indexing")
                raise KeywordProcessorError("Keyword indexing failed: {}".format(str(e)))
            raise

    def text_exists(self, id: str) -> bool:
        """Check if text exists in index.

        Args:
            id: Document ID to check

        Returns:
            bool: True if text exists, False otherwise

        Raises:
            KeywordProcessorError: If check fails
        """
        if not id:
            return False

        try:
            keyword_table = self._get_dataset_keyword_table()
            if keyword_table is None:
                return False
            return id in set.union(*keyword_table.values()) if keyword_table else False
        except Exception as e:
            logger.exception("Failed to check text existence")
            raise KeywordProcessorError("Failed to check text existence: {}".format(str(e)))

    def delete_by_ids(self, ids: list[str]) -> None:
        """Delete texts by IDs.

        Args:
            ids: List of document IDs to delete

        Raises:
            KeywordStorageError: If deletion fails
        """
        if not ids:
            return

        lock_name = "keyword_indexing_lock_{}".format(self.dataset.id)
        try:
            with redis_client.lock(lock_name, timeout=600):
                keyword_table = self._get_dataset_keyword_table()
                if keyword_table is not None:
                    keyword_table = self._delete_ids_from_keyword_table(keyword_table, ids)
                    self._save_dataset_keyword_table(keyword_table)
        except Exception as e:
            logger.exception("Failed to delete documents")
            raise KeywordStorageError("Failed to delete documents: {}".format(str(e)))

    def delete(self) -> None:
        """Delete entire index.

        Raises:
            KeywordStorageError: If deletion fails
        """
        lock_name = "keyword_indexing_lock_{}".format(self.dataset.id)
        try:
            with redis_client.lock(lock_name, timeout=600):
                dataset_keyword_table = self.dataset.dataset_keyword_table
                if dataset_keyword_table:
                    db.session.delete(dataset_keyword_table)
                    db.session.commit()
                    if dataset_keyword_table.data_source_type != "database":
                        file_key = os.path.join("keyword_files", self.dataset.tenant_id, self.dataset.id + ".txt")
                        storage.delete(file_key)
        except Exception as e:
            logger.exception("Failed to delete index")
            raise KeywordStorageError("Failed to delete index: {}".format(str(e)))

    def search(self, query: str, **kwargs: Any) -> list[Document]:
        """Search documents using keywords.

        Args:
            query: Search query string
            **kwargs: Additional arguments including optional top_k

        Returns:
            List[Document]: List of matching documents

        Raises:
            KeywordProcessorError: If search fails
        """
        if not query:
            return []

        try:
            keyword_table = self._get_dataset_keyword_table()
            k = kwargs.get("top_k", 4)

            sorted_chunk_indices = self._retrieve_ids_by_query(keyword_table or {}, query, k)
            if not sorted_chunk_indices:
                return []

            documents = []
            for chunk_index in sorted_chunk_indices:
                segment = (
                    db.session.query(DocumentSegment)
                    .filter(DocumentSegment.dataset_id == self.dataset.id, DocumentSegment.index_node_id == chunk_index)
                    .first()
                )

                if segment:
                    documents.append(
                        Document(
                            page_content=segment.content,
                            metadata={
                                "doc_id": chunk_index,
                                "doc_hash": segment.index_node_hash,
                                "document_id": segment.document_id,
                                "dataset_id": segment.dataset_id,
                            },
                        )
                    )

            return documents
        except Exception as e:
            logger.exception("Failed to search documents")
            raise KeywordProcessorError("Search failed: {}".format(str(e)))

    def _get_dataset_keyword_table(self) -> Optional[dict[str, set[str]]]:
        """Get keyword table from storage."""
        try:
            dataset_keyword_table = self.dataset.dataset_keyword_table
            if dataset_keyword_table:
                keyword_table_dict = dataset_keyword_table.keyword_table_dict
                if keyword_table_dict:
                    return dict(keyword_table_dict["__data__"]["table"])
            else:
                # Create new dataset keyword table if it doesn't exist
                from configs import dify_config

                keyword_data_source_type = dify_config.KEYWORD_DATA_SOURCE_TYPE
                dataset_keyword_table = DatasetKeywordTable(
                    dataset_id=self.dataset.id,
                    keyword_table="",
                    data_source_type=keyword_data_source_type,
                )
                if keyword_data_source_type == "database":
                    dataset_keyword_table.keyword_table = json.dumps(
                        {
                            "__type__": "keyword_table",
                            "__data__": {"index_id": self.dataset.id, "summary": None, "table": {}},
                        },
                        cls=SetEncoder,
                    )
                db.session.add(dataset_keyword_table)
                db.session.commit()

            return {}
        except Exception as e:
            logger.exception("Failed to get keyword table")
            raise KeywordStorageError("Failed to get keyword table: {}".format(str(e)))

    def _save_dataset_keyword_table(self, keyword_table: dict[str, set[str]]) -> None:
        """Save keyword table to storage."""
        if keyword_table is None:
            raise ValueError("Keyword table cannot be None")

        table_dict = {
            "__type__": "keyword_table",
            "__data__": {"index_id": self.dataset.id, "summary": None, "table": keyword_table},
        }

        try:
            dataset_keyword_table = self.dataset.dataset_keyword_table
            if not dataset_keyword_table:
                raise KeywordStorageError("Dataset keyword table not found")

            data_source_type = dataset_keyword_table.data_source_type

            if data_source_type == "database":
                dataset_keyword_table.keyword_table = json.dumps(table_dict, cls=SetEncoder)
                db.session.commit()
            else:
                file_key = os.path.join("keyword_files", self.dataset.tenant_id, self.dataset.id + ".txt")
                if storage.exists(file_key):
                    storage.delete(file_key)
                storage.save(file_key, json.dumps(table_dict, cls=SetEncoder).encode("utf-8"))
        except Exception as e:
            logger.exception("Failed to save keyword table")
            raise KeywordStorageError("Failed to save keyword table: {}".format(str(e)))

    def _add_text_to_keyword_table(
        self, keyword_table: dict[str, set[str]], id: str, keywords: list[str]
    ) -> dict[str, set[str]]:
        """Add text keywords to table."""
        if not id or not keywords:
            return keyword_table

        for keyword in keywords:
            if keyword not in keyword_table:
                keyword_table[keyword] = set()
            keyword_table[keyword].add(id)
        return keyword_table

    def _delete_ids_from_keyword_table(self, keyword_table: dict[str, set[str]], ids: list[str]) -> dict[str, set[str]]:
        """Delete IDs from keyword table."""
        if not keyword_table or not ids:
            return keyword_table

        node_idxs_to_delete = set(ids)
        keywords_to_delete = set()

        for keyword, node_idxs in keyword_table.items():
            if node_idxs_to_delete.intersection(node_idxs):
                keyword_table[keyword] = node_idxs.difference(node_idxs_to_delete)
                if not keyword_table[keyword]:
                    keywords_to_delete.add(keyword)

        for keyword in keywords_to_delete:
            del keyword_table[keyword]

        return keyword_table

    def _retrieve_ids_by_query(self, keyword_table: dict[str, set[str]], query: str, k: int = 4) -> list[str]:
        """Retrieve document IDs by query."""
        if not query or not keyword_table:
            return []

        try:
            keywords = self._keyword_handler.extract_keywords(query)

            # Score documents based on matching keywords
            chunk_indices_count: dict[str, int] = defaultdict(int)
            keywords_list = [keyword for keyword in keywords if keyword in set(keyword_table.keys())]

            for keyword in keywords_list:
                for node_id in keyword_table[keyword]:
                    chunk_indices_count[node_id] += 1

            # Sort by score in descending order
            sorted_chunk_indices = sorted(
                chunk_indices_count.keys(),
                key=lambda x: chunk_indices_count[x],
                reverse=True,
            )

            return sorted_chunk_indices[:k]
        except Exception as e:
            logger.exception("Failed to retrieve IDs by query")
            raise KeywordExtractionError("Failed to retrieve IDs: {}".format(str(e)))

    def _update_segment_keywords(self, dataset_id: str, node_id: str, keywords: list[str]) -> None:
        """Update segment keywords in database."""
        if not dataset_id or not node_id or not keywords:
            return

        try:
            document_segment = (
                db.session.query(DocumentSegment)
                .filter(DocumentSegment.dataset_id == dataset_id, DocumentSegment.index_node_id == node_id)
                .first()
            )

            if document_segment:
                document_segment.keywords = keywords
                db.session.add(document_segment)
                db.session.commit()
        except Exception as e:
            logger.exception("Failed to update segment keywords")
            raise KeywordStorageError("Failed to update segment keywords: {}".format(str(e)))

    def create_segment_keywords(self, node_id: str, keywords: list[str]) -> None:
        """Create keywords for a single segment.

        Args:
            node_id: The segment node ID
            keywords: List of keywords to add
        """
        if not node_id or not keywords:
            return

        try:
            keyword_table = self._get_dataset_keyword_table()
            self._update_segment_keywords(self.dataset.id, node_id, keywords)
            keyword_table = self._add_text_to_keyword_table(keyword_table or {}, node_id, keywords)
            self._save_dataset_keyword_table(keyword_table)
        except Exception as e:
            logger.exception("Failed to create segment keywords")
            raise KeywordProcessorError("Failed to create segment keywords: {}".format(str(e)))

    def multi_create_segment_keywords(self, pre_segment_data_list: list[dict[str, Any]]) -> None:
        """Create keywords for multiple segments in batch."""
        if not pre_segment_data_list:
            return

        try:
            keyword_table = self._get_dataset_keyword_table()
            if keyword_table is None:
                keyword_table = {}

            for pre_segment_data in pre_segment_data_list:
                segment = pre_segment_data["segment"]
                if not segment:
                    continue

                try:
                    if pre_segment_data.get("keywords"):
                        segment.keywords = pre_segment_data["keywords"]
                        keyword_table = self._add_text_to_keyword_table(
                            keyword_table, segment.index_node_id, pre_segment_data["keywords"]
                        )
                    else:
                        keywords = self._keyword_handler.extract_keywords(
                            segment.content, self._config.max_keywords_per_chunk
                        )
                        segment.keywords = list(keywords)
                        keyword_table = self._add_text_to_keyword_table(
                            keyword_table, segment.index_node_id, list(keywords)
                        )
                except Exception as e:
                    logger.exception("Failed to process segment: {}".format(segment.index_node_id))
                    continue

            self._save_dataset_keyword_table(keyword_table)
        except Exception as e:
            logger.exception("Failed to create multiple segment keywords")
            raise KeywordProcessorError("Failed to create multiple segment keywords: {}".format(str(e)))

    def update_segment_keywords_index(self, node_id: str, keywords: list[str]) -> None:
        """Update keywords index for a segment.

        Args:
            node_id: The segment node ID
            keywords: List of keywords to update
        """
        if not node_id or not keywords:
            return

        try:
            keyword_table = self._get_dataset_keyword_table()
            keyword_table = self._add_text_to_keyword_table(keyword_table or {}, node_id, keywords)
            self._save_dataset_keyword_table(keyword_table)
        except Exception as e:
            logger.exception("Failed to update segment keywords index")
            raise KeywordStorageError("Failed to update segment keywords index: {}".format(str(e)))
