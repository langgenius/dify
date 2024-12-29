import json
from collections import defaultdict
from typing import Any, Optional

from configs import dify_config
from core.rag.datasource.keyword.japanese.japanese_keyword_table_handler import JapaneseKeywordTableHandler
from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.dataset import DatasetKeywordTable, DocumentSegment


class JapaneseKeywordExtractor(BaseKeyword):
    def __init__(self, dataset):
        super().__init__(dataset)
        self.keyword_table_handler = JapaneseKeywordTableHandler()
        self.lock_name = f"keyword_indexing_lock_{self.dataset.id}"

    def create(self, texts: list[Document], **kwargs) -> BaseKeyword:
        with redis_client.lock(self.lock_name, timeout=600):
            keyword_table = self._get_dataset_keyword_table()
            for text in texts:
                keywords = self.keyword_table_handler.extract_keywords(
                    text.page_content, self._config.max_keywords_per_chunk
                )
                if text.metadata is not None:
                    self._update_segment_keywords(self.dataset.id, text.metadata["doc_id"], list(keywords))
                    keyword_table = self._add_text_to_keyword_table(
                        keyword_table or {}, text.metadata["doc_id"], list(keywords)
                    )
            self._save_dataset_keyword_table(keyword_table)
            return self

    def add_texts(self, texts: list[Document], **kwargs):
        with redis_client.lock(self.lock_name, timeout=600):
            keyword_table = self._get_dataset_keyword_table()
            keywords_list = kwargs.get("keywords_list")
            for i in range(len(texts)):
                text = texts[i]
                if keywords_list:
                    keywords = keywords_list[i]
                    if not keywords:
                        keywords = self.keyword_table_handler.extract_keywords(
                            text.page_content, self._config.max_keywords_per_chunk
                        )
                else:
                    keywords = self.keyword_table_handler.extract_keywords(
                        text.page_content, self._config.max_keywords_per_chunk
                    )
                if text.metadata is not None:
                    self._update_segment_keywords(self.dataset.id, text.metadata["doc_id"], list(keywords))
                    keyword_table = self._add_text_to_keyword_table(
                        keyword_table or {}, text.metadata["doc_id"], list(keywords)
                    )
            self._save_dataset_keyword_table(keyword_table)

    def text_exists(self, id: str) -> bool:
        keyword_table = self._get_dataset_keyword_table()
        if keyword_table is None:
            return False
        return id in set.union(*keyword_table.values())

    def delete_by_ids(self, ids: list[str]) -> None:
        with redis_client.lock(self.lock_name, timeout=600):
            keyword_table = self._get_dataset_keyword_table()
            if keyword_table is not None:
                keyword_table = self._delete_ids_from_keyword_table(keyword_table, ids)
            self._save_dataset_keyword_table(keyword_table)

    def search(self, query: str, **kwargs: Any) -> list[Document]:
        keyword_table = self._get_dataset_keyword_table()
        k = kwargs.get("top_k", 4)
        sorted_chunk_indices = self._retrieve_ids_by_query(keyword_table or {}, query, k)
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

    def delete(self) -> None:
        with redis_client.lock(self.lock_name, timeout=600):
            dataset_keyword_table = self.dataset.dataset_keyword_table
            if dataset_keyword_table:
                db.session.delete(dataset_keyword_table)
                db.session.commit()
                if dataset_keyword_table.data_source_type != "database":
                    file_key = f"keyword_files/{self.dataset.tenant_id}/{self.dataset.id}.txt"
                    storage.delete(file_key)

    def _save_dataset_keyword_table(self, keyword_table):
        keyword_table_dict = {
            "__type__": "keyword_table",
            "__data__": {"index_id": self.dataset.id, "summary": None, "table": keyword_table},
        }
        dataset_keyword_table = self.dataset.dataset_keyword_table
        keyword_data_source_type = dataset_keyword_table.data_source_type
        if keyword_data_source_type == "database":
            dataset_keyword_table.keyword_table = json.dumps(keyword_table_dict, cls=SetEncoder)
            db.session.commit()
        else:
            file_key = f"keyword_files/{self.dataset.tenant_id}/{self.dataset.id}.txt"
            if storage.exists(file_key):
                storage.delete(file_key)
            storage.save(file_key, json.dumps(keyword_table_dict, cls=SetEncoder).encode("utf-8"))

    def _get_dataset_keyword_table(self) -> Optional[dict]:
        dataset_keyword_table = self.dataset.dataset_keyword_table
        if dataset_keyword_table:
            keyword_table_dict = dataset_keyword_table.keyword_table_dict
            if keyword_table_dict:
                return dict(keyword_table_dict["__data__"]["table"])
        else:
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

    def _add_text_to_keyword_table(self, keyword_table: dict, id: str, keywords: list[str]) -> dict:
        for keyword in keywords:
            if keyword not in keyword_table:
                keyword_table[keyword] = set()
            keyword_table[keyword].add(id)
        return keyword_table

    def _delete_ids_from_keyword_table(self, keyword_table: dict, ids: list[str]) -> dict:
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

    def _retrieve_ids_by_query(self, keyword_table: dict, query: str, k: int = 4):
        keywords = self.keyword_table_handler.extract_keywords(query)
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

    def _update_segment_keywords(self, dataset_id: str, node_id: str, keywords: list[str]):
        document_segment = (
            db.session.query(DocumentSegment)
            .filter(DocumentSegment.dataset_id == dataset_id, DocumentSegment.index_node_id == node_id)
            .first()
        )
        if document_segment:
            document_segment.keywords = keywords
            db.session.add(document_segment)
            db.session.commit()


class SetEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, set):
            return list(obj)
        return super().default(obj)
