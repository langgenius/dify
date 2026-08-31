from collections import defaultdict
from typing import Any, TypedDict, override

import orjson
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.dataset import ChildChunk, Dataset, DatasetKeywordTable, DocumentSegment


class PreSegmentData(TypedDict):
    segment: DocumentSegment
    keywords: list[str]


class KeywordTableConfig(BaseModel):
    max_keywords_per_chunk: int = 10


class Jieba(BaseKeyword):
    def __init__(self, dataset: Dataset):
        super().__init__(dataset)
        self._config = KeywordTableConfig()

    @override
    def create(self, texts: list[Document], session: Session, **kwargs: Any) -> BaseKeyword:
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            keyword_table_handler = JiebaKeywordTableHandler()
            keyword_table = self._get_dataset_keyword_table(session=session)
            keyword_number = self.dataset.keyword_number or self._config.max_keywords_per_chunk

            for text in texts:
                keywords = keyword_table_handler.extract_keywords(text.page_content, keyword_number)
                if text.metadata is not None:
                    self._update_segment_keywords(self.dataset.id, text.metadata["doc_id"], list(keywords), session)
                    keyword_table = self._add_text_to_keyword_table(
                        keyword_table or {}, text.metadata["doc_id"], list(keywords)
                    )

            self._save_dataset_keyword_table(keyword_table, session)

            return self

    @override
    def add_texts(self, texts: list[Document], session: Session, **kwargs: Any):
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            keyword_table_handler = JiebaKeywordTableHandler()

            keyword_table = self._get_dataset_keyword_table(session=session)
            keywords_list = kwargs.get("keywords_list")
            keyword_number = self.dataset.keyword_number or self._config.max_keywords_per_chunk
            for i in range(len(texts)):
                text = texts[i]
                if keywords_list:
                    keywords = keywords_list[i]
                    if not keywords:
                        keywords = keyword_table_handler.extract_keywords(text.page_content, keyword_number)
                else:
                    keywords = keyword_table_handler.extract_keywords(text.page_content, keyword_number)
                if text.metadata is not None:
                    self._update_segment_keywords(self.dataset.id, text.metadata["doc_id"], list(keywords), session)
                    keyword_table = self._add_text_to_keyword_table(
                        keyword_table or {}, text.metadata["doc_id"], list(keywords)
                    )

            self._save_dataset_keyword_table(keyword_table, session)

    @override
    def text_exists(self, id: str, *, session: Session) -> bool:
        dataset_keyword_table = self.dataset.get_dataset_keyword_table(session=session)
        keyword_table = None
        keyword_table_dict = (
            dataset_keyword_table.get_keyword_table_dict(session=session) if dataset_keyword_table else None
        )
        if keyword_table_dict:
            data: Any = keyword_table_dict["__data__"]
            keyword_table = dict(data["table"])
        if keyword_table is None:
            return False
        return id in set.union(*keyword_table.values())

    @override
    def delete_by_ids(self, ids: list[str], session: Session, **kwargs: Any):
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            keyword_table = self._get_dataset_keyword_table(session)
            if keyword_table is not None:
                keyword_table = self._delete_ids_from_keyword_table(keyword_table, ids)

            self._save_dataset_keyword_table(keyword_table, session)

    @override
    def search(self, query: str, *, session: Session, **kwargs: Any) -> list[Document]:
        dataset_keyword_table = self.dataset.get_dataset_keyword_table(session=session)
        keyword_table = None
        keyword_table_dict = (
            dataset_keyword_table.get_keyword_table_dict(session=session) if dataset_keyword_table else None
        )
        if keyword_table_dict:
            data: Any = keyword_table_dict["__data__"]
            keyword_table = dict(data["table"])

        k = kwargs.get("top_k", 4)
        document_ids_filter = kwargs.get("document_ids_filter")
        sorted_chunk_indices = self._retrieve_ids_by_query(keyword_table or {}, query, k)

        if not sorted_chunk_indices:
            return []

        # Resolve from both DocumentSegment (parent segments) and ChildChunk
        # (parent-child mode). Pre-fix, only DocumentSegment was queried, so
        # child chunk keyword hits were silently dropped and keyword retrieval
        # returned no results even when the keyword table had matching entries.
        # See #40680.
        segment_query_stmt = select(DocumentSegment).where(
            DocumentSegment.dataset_id == self.dataset.id, DocumentSegment.index_node_id.in_(sorted_chunk_indices)
        )
        child_chunk_query_stmt = select(ChildChunk).where(
            ChildChunk.dataset_id == self.dataset.id, ChildChunk.index_node_id.in_(sorted_chunk_indices)
        )
        if document_ids_filter:
            segment_query_stmt = segment_query_stmt.where(DocumentSegment.document_id.in_(document_ids_filter))
            child_chunk_query_stmt = child_chunk_query_stmt.where(ChildChunk.document_id.in_(document_ids_filter))

        segments = session.scalars(segment_query_stmt).all()
        child_chunks = session.scalars(child_chunk_query_stmt).all()

        # Build an index_node_id -> (content, metadata) lookup for both kinds.
        # The hit ranking is preserved by iterating `sorted_chunk_indices` in order
        # below; duplicates are skipped.
        node_lookup: dict[str, tuple[str, dict[str, Any]]] = {}
        for segment in segments:
            if segment.index_node_id is None:
                continue
            node_lookup[segment.index_node_id] = (
                segment.content,
                {
                    "doc_id": segment.index_node_id,
                    "doc_hash": segment.index_node_hash,
                    "document_id": segment.document_id,
                    "dataset_id": segment.dataset_id,
                    "segment_id": segment.id,
                    "is_child_chunk": False,
                },
            )
        for child_chunk in child_chunks:
            if child_chunk.index_node_id is None:
                continue
            node_lookup[child_chunk.index_node_id] = (
                child_chunk.content,
                {
                    "doc_id": child_chunk.index_node_id,
                    "doc_hash": child_chunk.index_node_hash,
                    "document_id": child_chunk.document_id,
                    "dataset_id": child_chunk.dataset_id,
                    "segment_id": child_chunk.segment_id,
                    "is_child_chunk": True,
                },
            )

        documents: list[Document] = []
        for chunk_index in sorted_chunk_indices:
            entry = node_lookup.get(chunk_index)
            if entry is None:
                continue
            page_content, metadata = entry
            documents.append(Document(page_content=page_content, metadata=metadata))

        return documents

    @override
    def delete(self, *, session: Session):
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            dataset_keyword_table = self.dataset.get_dataset_keyword_table(session=session)
            if dataset_keyword_table:
                session.delete(dataset_keyword_table)
                session.commit()
                if dataset_keyword_table.data_source_type != "database":
                    file_key = "keyword_files/" + self.dataset.tenant_id + "/" + self.dataset.id + ".txt"
                    storage.delete(file_key)

    def _save_dataset_keyword_table(self, keyword_table: dict[str, set[str]] | None, session: Session):
        keyword_table_dict = {
            "__type__": "keyword_table",
            "__data__": {"index_id": self.dataset.id, "summary": None, "table": keyword_table},
        }
        dataset_keyword_table = session.scalar(
            select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == self.dataset.id)
        )
        keyword_data_source_type = dataset_keyword_table.data_source_type if dataset_keyword_table else "file"
        if keyword_data_source_type == "database":
            if dataset_keyword_table is None:
                return
            dataset_keyword_table.keyword_table = dumps_with_sets(keyword_table_dict)
            session.flush()
        else:
            file_key = "keyword_files/" + self.dataset.tenant_id + "/" + self.dataset.id + ".txt"
            if storage.exists(file_key):
                storage.delete(file_key)
            storage.save(file_key, dumps_with_sets(keyword_table_dict).encode("utf-8"))

    def _get_dataset_keyword_table(self, session: Session) -> dict[str, set[str]] | None:
        dataset_keyword_table = session.scalar(
            select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == self.dataset.id)
        )
        if dataset_keyword_table:
            keyword_table_dict = dataset_keyword_table.get_keyword_table_dict(session=session)
            if keyword_table_dict:
                data: Any = keyword_table_dict["__data__"]
                return dict(data["table"])
        else:
            keyword_data_source_type = dify_config.KEYWORD_DATA_SOURCE_TYPE
            dataset_keyword_table = DatasetKeywordTable(
                dataset_id=self.dataset.id,
                keyword_table="",
                data_source_type=keyword_data_source_type,
            )
            if keyword_data_source_type == "database":
                dataset_keyword_table.keyword_table = dumps_with_sets(
                    {
                        "__type__": "keyword_table",
                        "__data__": {"index_id": self.dataset.id, "summary": None, "table": {}},
                    }
                )
            session.add(dataset_keyword_table)
            session.flush()

        return {}

    def _add_text_to_keyword_table(
        self, keyword_table: dict[str, set[str]], id: str, keywords: list[str]
    ) -> dict[str, set[str]]:
        for keyword in keywords:
            if keyword not in keyword_table:
                keyword_table[keyword] = set()
            keyword_table[keyword].add(id)
        return keyword_table

    def _delete_ids_from_keyword_table(self, keyword_table: dict[str, set[str]], ids: list[str]) -> dict[str, set[str]]:
        # get set of ids that correspond to node
        node_idxs_to_delete = set(ids)

        # delete node_idxs from keyword to node idxs mapping
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
        keyword_table_handler = JiebaKeywordTableHandler()
        keywords = keyword_table_handler.extract_keywords(query)

        # go through text chunks in order of most matching keywords
        chunk_indices_count: dict[str, int] = defaultdict(int)
        keywords_list = [keyword for keyword in keywords if keyword in set(keyword_table.keys())]
        for keyword in keywords_list:
            for node_id in keyword_table[keyword]:
                chunk_indices_count[node_id] += 1

        sorted_chunk_indices = sorted(
            chunk_indices_count.keys(),
            key=lambda x: chunk_indices_count[x],
            reverse=True,
        )

        return sorted_chunk_indices[:k]

    def _update_segment_keywords(self, dataset_id: str, node_id: str, keywords: list[str], session: Session):
        stmt = select(DocumentSegment).where(
            DocumentSegment.dataset_id == dataset_id, DocumentSegment.index_node_id == node_id
        )
        document_segment = session.scalar(stmt)
        if document_segment:
            document_segment.keywords = keywords
            session.add(document_segment)
            session.flush()

    def create_segment_keywords(self, node_id: str, keywords: list[str], session: Session):
        keyword_table = self._get_dataset_keyword_table(session)
        self._update_segment_keywords(self.dataset.id, node_id, keywords, session)
        keyword_table = self._add_text_to_keyword_table(keyword_table or {}, node_id, keywords)
        self._save_dataset_keyword_table(keyword_table, session)

    def multi_create_segment_keywords(self, pre_segment_data_list: list[PreSegmentData], session: Session):
        keyword_table_handler = JiebaKeywordTableHandler()
        keyword_table = self._get_dataset_keyword_table(session)
        for pre_segment_data in pre_segment_data_list:
            segment = pre_segment_data["segment"]
            if pre_segment_data["keywords"]:
                segment.keywords = pre_segment_data["keywords"]
                assert segment.index_node_id
                keyword_table = self._add_text_to_keyword_table(
                    keyword_table or {}, segment.index_node_id, pre_segment_data["keywords"]
                )
            else:
                keyword_number = self.dataset.keyword_number or self._config.max_keywords_per_chunk

                keywords = keyword_table_handler.extract_keywords(segment.content, keyword_number)
                segment.keywords = list(keywords)
                assert segment.index_node_id
                keyword_table = self._add_text_to_keyword_table(
                    keyword_table or {}, segment.index_node_id, list(keywords)
                )
        self._save_dataset_keyword_table(keyword_table, session)

    def update_segment_keywords_index(self, node_id: str, keywords: list[str], session: Session):
        keyword_table = self._get_dataset_keyword_table(session)
        keyword_table = self._add_text_to_keyword_table(keyword_table or {}, node_id, keywords)
        self._save_dataset_keyword_table(keyword_table, session)

    def add_child_chunk_keywords(self, child_chunk: ChildChunk, session: Session) -> None:
        """Add a child chunk's keywords to the dataset keyword table.

        Called during child chunk creation and during parent-child economy
        indexing, where the child node IDs were previously missing from the
        keyword table. See #40680.
        """
        if not child_chunk.index_node_id:
            return
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            keyword_table_handler = JiebaKeywordTableHandler()
            keyword_number = self.dataset.keyword_number or self._config.max_keywords_per_chunk
            keywords = list(keyword_table_handler.extract_keywords(child_chunk.content, keyword_number))
            keyword_table = self._get_dataset_keyword_table(session)
            keyword_table = self._add_text_to_keyword_table(keyword_table or {}, child_chunk.index_node_id, keywords)
            self._save_dataset_keyword_table(keyword_table, session)

    def delete_child_chunk_keywords(self, child_chunk: ChildChunk, session: Session) -> None:
        """Remove a child chunk's keywords from the dataset keyword table.

        Called during child chunk delete and during segment-level cleanup that
        cascades to child chunks. The child chunk's `index_node_id` is used
        as the keyword-table key. See #40680.
        """
        if not child_chunk.index_node_id:
            return
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            keyword_table = self._get_dataset_keyword_table(session)
            if keyword_table is not None:
                keyword_table = self._delete_ids_from_keyword_table(keyword_table, [child_chunk.index_node_id])
            self._save_dataset_keyword_table(keyword_table, session)

    def update_child_chunk_keywords(self, child_chunk: ChildChunk, session: Session) -> None:
        """Re-extract and replace a child chunk's keywords in the keyword table.

        Called when a child chunk's content is edited: the old keywords for
        the same `index_node_id` are removed and the new keywords (extracted
        from the new content) are inserted. See #40680.
        """
        self.delete_child_chunk_keywords(child_chunk, session)
        self.add_child_chunk_keywords(child_chunk, session)


def set_orjson_default(obj: Any):
    """Default function for orjson serialization of set types"""
    if isinstance(obj, set):
        return list(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def dumps_with_sets(obj: Any) -> str:
    """JSON dumps with set support using orjson"""
    return orjson.dumps(obj, default=set_orjson_default).decode("utf-8")
