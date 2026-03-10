"""Keyword index implementation backed by normalized per-keyword rows.

Legacy datasets may still have a blob/file-backed keyword index tracked by
``dataset_keyword_tables``. The runtime migrates those datasets once under the
existing dataset-level Redis lock, then all reads and writes operate only on
``dataset_keyword_entries`` plus ``DocumentSegment.keywords``.
"""

from typing import Any
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy import and_, func, insert, select

from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, DatasetKeywordEntry, DatasetKeywordTable, DocumentSegment


class KeywordTableConfig(BaseModel):
    max_keywords_per_chunk: int = 10


class Jieba(BaseKeyword):
    def __init__(self, dataset: Dataset):
        super().__init__(dataset)
        self._config = KeywordTableConfig()

    def create(self, texts: list[Document], **kwargs) -> BaseKeyword:
        with redis_client.lock(self._get_lock_name(), timeout=600):
            self._ensure_keyword_index_migrated(assume_locked=True)
            segment_keywords = self._collect_segment_keywords(texts, kwargs.get("keywords_list"))
            self._replace_segment_keywords(self.dataset.id, segment_keywords)
            return self

    def add_texts(self, texts: list[Document], **kwargs):
        with redis_client.lock(self._get_lock_name(), timeout=600):
            self._ensure_keyword_index_migrated(assume_locked=True)
            segment_keywords = self._collect_segment_keywords(texts, kwargs.get("keywords_list"))
            self._replace_segment_keywords(self.dataset.id, segment_keywords)

    def text_exists(self, id: str) -> bool:
        stmt = (
            select(DocumentSegment.id)
            .where(DocumentSegment.dataset_id == self.dataset.id, DocumentSegment.index_node_id == id)
            .limit(1)
        )
        return db.session.scalar(stmt) is not None

    def delete_by_ids(self, ids: list[str]):
        with redis_client.lock(self._get_lock_name(), timeout=600):
            self._ensure_keyword_index_migrated(assume_locked=True)
            self._delete_keyword_entries(ids)
            db.session.commit()

    def search(self, query: str, **kwargs: Any) -> list[Document]:
        self._ensure_keyword_index_migrated()

        k = kwargs.get("top_k", 4)
        document_ids_filter = kwargs.get("document_ids_filter")
        sorted_chunk_indices = self._retrieve_ids_by_query(query, k, document_ids_filter)
        if not sorted_chunk_indices:
            return []

        documents = []
        segment_query_stmt = select(DocumentSegment).where(
            DocumentSegment.dataset_id == self.dataset.id,
            DocumentSegment.index_node_id.in_(sorted_chunk_indices),
        )
        segments = db.session.execute(segment_query_stmt).scalars().all()
        segment_map = {segment.index_node_id: segment for segment in segments}
        for chunk_index in sorted_chunk_indices:
            segment = segment_map.get(chunk_index)
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

    def delete(self):
        with redis_client.lock(self._get_lock_name(), timeout=600):
            self._delete_keyword_entries_for_dataset()

            dataset_keyword_table = self.dataset.dataset_keyword_table
            if dataset_keyword_table:
                if dataset_keyword_table.data_source_type != "database":
                    file_key = self._get_legacy_file_key()
                    if storage.exists(file_key):
                        storage.delete(file_key)
                db.session.delete(dataset_keyword_table)

            db.session.commit()

    def create_segment_keywords(self, node_id: str, keywords: list[str]):
        with redis_client.lock(self._get_lock_name(), timeout=600):
            self._ensure_keyword_index_migrated(assume_locked=True)
            self._replace_segment_keywords(self.dataset.id, {node_id: keywords})

    def multi_create_segment_keywords(self, pre_segment_data_list: list):
        with redis_client.lock(self._get_lock_name(), timeout=600):
            self._ensure_keyword_index_migrated(assume_locked=True)

            keyword_table_handler = JiebaKeywordTableHandler()
            keyword_number = self.dataset.keyword_number or self._config.max_keywords_per_chunk
            segment_keywords: dict[str, list[str]] = {}

            for pre_segment_data in pre_segment_data_list:
                segment = pre_segment_data["segment"]
                keywords = pre_segment_data["keywords"]
                if not keywords:
                    keywords = list(keyword_table_handler.extract_keywords(segment.content, keyword_number))
                segment.keywords = keywords
                segment_keywords[segment.index_node_id] = keywords

            self._replace_segment_keywords(self.dataset.id, segment_keywords)

    def update_segment_keywords_index(self, node_id: str, keywords: list[str]):
        with redis_client.lock(self._get_lock_name(), timeout=600):
            self._ensure_keyword_index_migrated(assume_locked=True)
            self._replace_segment_keywords(self.dataset.id, {node_id: keywords})

    def _get_lock_name(self) -> str:
        return f"keyword_indexing_lock_{self.dataset.id}"

    def _get_legacy_file_key(self) -> str:
        return "keyword_files/" + self.dataset.tenant_id + "/" + self.dataset.id + ".txt"

    def _collect_segment_keywords(
        self, texts: list[Document], keywords_list: list[list[str] | None] | None = None
    ) -> dict[str, list[str]]:
        keyword_table_handler = JiebaKeywordTableHandler()
        keyword_number = self.dataset.keyword_number or self._config.max_keywords_per_chunk
        segment_keywords: dict[str, list[str]] = {}

        for index, text in enumerate(texts):
            if text.metadata is None:
                continue

            keywords = keywords_list[index] if keywords_list else None
            if not keywords:
                keywords = list(keyword_table_handler.extract_keywords(text.page_content, keyword_number))

            segment_keywords[text.metadata["doc_id"]] = list(keywords)

        return segment_keywords

    def _ensure_keyword_index_migrated(self, assume_locked: bool = False) -> None:
        """Normalize legacy blob/file-backed keyword indexes before using the new table."""

        dataset_keyword_table = self.dataset.dataset_keyword_table
        if (
            dataset_keyword_table is None
            or dataset_keyword_table.storage_version == DatasetKeywordTable.STORAGE_VERSION_NORMALIZED
        ):
            return

        if assume_locked:
            self._migrate_legacy_keyword_index(dataset_keyword_table)
            return

        with redis_client.lock(self._get_lock_name(), timeout=600):
            dataset_keyword_table = self.dataset.dataset_keyword_table
            if (
                dataset_keyword_table is None
                or dataset_keyword_table.storage_version == DatasetKeywordTable.STORAGE_VERSION_NORMALIZED
            ):
                return

            self._migrate_legacy_keyword_index(dataset_keyword_table)

    def _migrate_legacy_keyword_index(self, dataset_keyword_table: DatasetKeywordTable) -> None:
        legacy_keyword_table_dict = dataset_keyword_table.keyword_table_dict
        legacy_keyword_table = (
            legacy_keyword_table_dict.get("__data__", {}).get("table", {}) if legacy_keyword_table_dict else {}
        )
        segment_keywords = self._invert_legacy_keyword_table(legacy_keyword_table)

        self._delete_keyword_entries_for_dataset()
        entry_rows = self._build_keyword_entry_rows(segment_keywords)
        if entry_rows:
            db.session.execute(insert(DatasetKeywordEntry), entry_rows)
        dataset_keyword_table.storage_version = DatasetKeywordTable.STORAGE_VERSION_NORMALIZED
        dataset_keyword_table.migrated_at = naive_utc_now()
        db.session.add(dataset_keyword_table)
        db.session.commit()

    def _invert_legacy_keyword_table(self, keyword_table: dict[str, set[str] | list[str]]) -> dict[str, list[str]]:
        segment_keywords: dict[str, list[str]] = {}

        for keyword, segment_ids in keyword_table.items():
            for segment_id in segment_ids:
                segment_keywords.setdefault(segment_id, []).append(keyword)

        return segment_keywords

    def _replace_segment_keywords(self, dataset_id: str, segment_keywords: dict[str, list[str]]) -> None:
        if not segment_keywords:
            return

        self._update_segment_keywords_batch(dataset_id, segment_keywords)
        self._replace_keyword_entries(segment_keywords)
        db.session.commit()

    def _replace_keyword_entries(self, segment_keywords: dict[str, list[str]]) -> None:
        segment_ids = list(segment_keywords.keys())
        self._delete_keyword_entries(segment_ids)

        entry_rows = self._build_keyword_entry_rows(segment_keywords)
        if entry_rows:
            db.session.execute(insert(DatasetKeywordEntry), entry_rows)

    def _build_keyword_entry_rows(self, segment_keywords: dict[str, list[str]]) -> list[dict[str, str]]:
        entry_rows: list[dict[str, str]] = []

        for segment_id, keywords in segment_keywords.items():
            for keyword in set(keywords):
                entry_rows.append(
                    {
                        "id": str(uuid4()),
                        "dataset_id": self.dataset.id,
                        "keyword": keyword,
                        "segment_id": segment_id,
                    }
                )

        return entry_rows

    def _delete_keyword_entries(self, segment_ids: list[str]) -> None:
        if not segment_ids:
            return

        (
            db.session.query(DatasetKeywordEntry)
            .where(DatasetKeywordEntry.dataset_id == self.dataset.id, DatasetKeywordEntry.segment_id.in_(segment_ids))
            .delete(synchronize_session=False)
        )

    def _delete_keyword_entries_for_dataset(self) -> None:
        (
            db.session.query(DatasetKeywordEntry)
            .where(DatasetKeywordEntry.dataset_id == self.dataset.id)
            .delete(synchronize_session=False)
        )

    def _retrieve_ids_by_query(self, query: str, k: int = 4, document_ids_filter: list[str] | None = None) -> list[str]:
        keywords = list(JiebaKeywordTableHandler().extract_keywords(query))
        if not keywords:
            return []

        match_count = func.count(DatasetKeywordEntry.keyword).label("match_count")
        stmt = (
            select(DatasetKeywordEntry.segment_id, match_count)
            .where(
                DatasetKeywordEntry.dataset_id == self.dataset.id,
                DatasetKeywordEntry.keyword.in_(keywords),
            )
        )
        if document_ids_filter:
            stmt = stmt.join(
                DocumentSegment,
                and_(
                    DocumentSegment.dataset_id == self.dataset.id,
                    DocumentSegment.index_node_id == DatasetKeywordEntry.segment_id,
                ),
            ).where(DocumentSegment.document_id.in_(document_ids_filter))

        stmt = (
            stmt.group_by(DatasetKeywordEntry.segment_id)
            .order_by(match_count.desc(), DatasetKeywordEntry.segment_id.asc())
            .limit(k)
        )
        return [row.segment_id for row in db.session.execute(stmt)]

    def _update_segment_keywords_batch(self, dataset_id: str, segment_keywords: dict[str, list[str]]) -> None:
        if not segment_keywords:
            return

        stmt = select(DocumentSegment).where(
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.index_node_id.in_(segment_keywords.keys()),
        )
        document_segments = db.session.execute(stmt).scalars().all()
        for document_segment in document_segments:
            keywords = segment_keywords.get(document_segment.index_node_id)
            if keywords is None:
                continue
            document_segment.keywords = keywords
            db.session.add(document_segment)
