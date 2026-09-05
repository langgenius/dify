from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractContextManager
from typing import Any, override

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.datasource.keyword.jieba.keyword_table import keyword_file_key, load_keyword_table, save_keyword_table
from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.dataset import Dataset, DocumentSegment


class KeywordTableConfig(BaseModel):
    max_keywords_per_chunk: int = 10


class Jieba(BaseKeyword):
    def __init__(self, dataset: Dataset):
        super().__init__(dataset)
        self._config = KeywordTableConfig()

    @override
    def create(self, texts: list[Document], session: Session, **kwargs: Any) -> BaseKeyword:
        self.add_texts(texts, session)
        return self

    @override
    def add_texts(self, texts: list[Document], session: Session, **kwargs: Any):
        self.update_texts(
            texts,
            read=lambda: self._read_keyword_record(session),
            write=lambda storage_type, data, keywords: self.dataset.save_keyword_table(
                session=session, storage_type=storage_type, data=data, keywords=keywords
            ),
            lock=redis_client.lock(f"keyword_indexing_lock_{self.dataset.id}", timeout=600),
            keywords_list=kwargs.get("keywords_list"),
        )

    def update_texts(
        self,
        texts: Sequence[Document],
        *,
        read: Callable[[], tuple[str, str | None]],
        write: Callable[[str, str, Mapping[str, Sequence[str]]], None],
        lock: AbstractContextManager[object],
        keywords_list: Sequence[Sequence[str] | None] | None = None,
        replace_existing: bool = False,
        deleted_ids: Sequence[str] = (),
    ) -> None:
        """Mutate the shared index with explicit persistence and one dataset lock.

        Repository callbacks may close their sessions before returning, keeping
        extraction and object-storage I/O outside database transactions.
        """
        with lock:
            storage_type, data = read()
            payload = load_keyword_table(
                tenant_id=self.dataset.tenant_id,
                dataset_id=self.dataset.id,
                storage_type=storage_type,
                data=data,
            )
            table = dict(payload["__data__"]["table"] or {}) if payload else {}
            removed = list(deleted_ids)
            if replace_existing:
                removed.extend(text.metadata["doc_id"] for text in texts)
            if removed:
                table = self._delete_ids_from_keyword_table(table, removed)
            handler: JiebaKeywordTableHandler | None = None
            keyword_number = self.dataset.keyword_number or self._config.max_keywords_per_chunk
            selected: dict[str, Sequence[str]] = {}
            for position, text in enumerate(texts):
                keywords = keywords_list[position] if keywords_list else None
                if not keywords:
                    if handler is None:
                        handler = JiebaKeywordTableHandler()
                    keywords = list(handler.extract_keywords(text.page_content, keyword_number))
                node_id = text.metadata["doc_id"]
                selected[node_id] = list(keywords)
                table = self._add_text_to_keyword_table(table, node_id, list(keywords))
            encoded = save_keyword_table(
                tenant_id=self.dataset.tenant_id,
                dataset_id=self.dataset.id,
                storage_type=storage_type,
                table=table,
            )
            write(storage_type, encoded, selected)

    def _read_keyword_record(self, session: Session) -> tuple[str, str | None]:
        row = self.dataset.get_dataset_keyword_table(session=session)
        return (row.data_source_type, row.keyword_table) if row else (dify_config.KEYWORD_DATA_SOURCE_TYPE, None)

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
        return any(id in node_ids for node_ids in keyword_table.values())

    @override
    def delete_by_ids(self, ids: list[str], session: Session, **kwargs: Any):
        self.update_texts(
            [],
            read=lambda: self._read_keyword_record(session),
            write=lambda storage_type, data, keywords: self.dataset.save_keyword_table(
                session=session, storage_type=storage_type, data=data, keywords=keywords
            ),
            lock=redis_client.lock(f"keyword_indexing_lock_{self.dataset.id}", timeout=600),
            deleted_ids=ids,
        )

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

        documents = []

        segment_query_stmt = select(DocumentSegment).where(
            DocumentSegment.dataset_id == self.dataset.id, DocumentSegment.index_node_id.in_(sorted_chunk_indices)
        )
        if document_ids_filter:
            segment_query_stmt = segment_query_stmt.where(DocumentSegment.document_id.in_(document_ids_filter))

        segments = session.scalars(segment_query_stmt).all()
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

    @override
    def delete(self, *, session: Session):
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            dataset_keyword_table = self.dataset.get_dataset_keyword_table(session=session)
            if dataset_keyword_table:
                session.delete(dataset_keyword_table)
                session.commit()
                if dataset_keyword_table.data_source_type != "database":
                    file_key = keyword_file_key(self.dataset.tenant_id, self.dataset.id)
                    storage.delete(file_key)

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
