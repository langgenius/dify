import json
from collections import defaultdict
from typing import Any, Optional

from pydantic import BaseModel

from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.models.document import Document
from extensions.ext_database import db
from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment


class KeywordTableConfig(BaseModel):
    max_keywords_per_chunk: int = 10


class Jieba(BaseKeyword):
    def __init__(self, dataset: Dataset):
        super().__init__(dataset)
        self._config = KeywordTableConfig()

    def create(self, texts: list[Document], **kwargs) -> BaseKeyword:
        keyword_table_handler = JiebaKeywordTableHandler()
        keyword_table = self._get_dataset_keyword_table()
        for text in texts:
            keywords = keyword_table_handler.extract_keywords(text.page_content, self._config.max_keywords_per_chunk)
            self._update_segment_keywords(self.dataset.id, text.metadata['doc_id'], list(keywords))
            keyword_table = self._add_text_to_keyword_table(keyword_table, text.metadata['doc_id'], list(keywords))

        self._save_dataset_keyword_table(keyword_table)

        return self

    def add_texts(self, texts: list[Document], **kwargs):
        keyword_table_handler = JiebaKeywordTableHandler()

        keyword_table = self._get_dataset_keyword_table()
        keywords_list = kwargs.get('keywords_list', None)
        for i in range(len(texts)):
            text = texts[i]
            if keywords_list:
                keywords = keywords_list[i]
            else:
                keywords = keyword_table_handler.extract_keywords(text.page_content, self._config.max_keywords_per_chunk)
            self._update_segment_keywords(self.dataset.id, text.metadata['doc_id'], list(keywords))
            keyword_table = self._add_text_to_keyword_table(keyword_table, text.metadata['doc_id'], list(keywords))

        self._save_dataset_keyword_table(keyword_table)

    def text_exists(self, id: str) -> bool:
        keyword_table = self._get_dataset_keyword_table()
        return id in set.union(*keyword_table.values())

    def delete_by_ids(self, ids: list[str]) -> None:
        keyword_table = self._get_dataset_keyword_table()
        keyword_table = self._delete_ids_from_keyword_table(keyword_table, ids)

        self._save_dataset_keyword_table(keyword_table)

    def delete_by_document_id(self, document_id: str):
        # get segment ids by document_id
        segments = db.session.query(DocumentSegment).filter(
            DocumentSegment.dataset_id == self.dataset.id,
            DocumentSegment.document_id == document_id
        ).all()

        ids = [segment.index_node_id for segment in segments]

        keyword_table = self._get_dataset_keyword_table()
        keyword_table = self._delete_ids_from_keyword_table(keyword_table, ids)

        self._save_dataset_keyword_table(keyword_table)

    def search(
            self, query: str,
            **kwargs: Any
    ) -> list[Document]:
        keyword_table = self._get_dataset_keyword_table()

        k = kwargs.get('top_k', 4)

        sorted_chunk_indices = self._retrieve_ids_by_query(keyword_table, query, k)

        documents = []
        for chunk_index in sorted_chunk_indices:
            segment = db.session.query(DocumentSegment).filter(
                DocumentSegment.dataset_id == self.dataset.id,
                DocumentSegment.index_node_id == chunk_index
            ).first()

            if segment:
                documents.append(Document(
                    page_content=segment.content,
                    metadata={
                        "doc_id": chunk_index,
                        "doc_hash": segment.index_node_hash,
                        "document_id": segment.document_id,
                        "dataset_id": segment.dataset_id,
                    }
                ))

        return documents

    def delete(self) -> None:
        dataset_keyword_table = self.dataset.dataset_keyword_table
        if dataset_keyword_table:
            db.session.delete(dataset_keyword_table)
            db.session.commit()

    def _save_dataset_keyword_table(self, keyword_table):
        keyword_table_dict = {
            '__type__': 'keyword_table',
            '__data__': {
                "index_id": self.dataset.id,
                "summary": None,
                "table": keyword_table
            }
        }
        self.dataset.dataset_keyword_table.keyword_table = json.dumps(keyword_table_dict, cls=SetEncoder)
        db.session.commit()

    def _get_dataset_keyword_table(self) -> Optional[dict]:
        dataset_keyword_table = self.dataset.dataset_keyword_table
        if dataset_keyword_table:
            if dataset_keyword_table.keyword_table_dict:
                return dataset_keyword_table.keyword_table_dict['__data__']['table']
        else:
            dataset_keyword_table = DatasetKeywordTable(
                dataset_id=self.dataset.id,
                keyword_table=json.dumps({
                    '__type__': 'keyword_table',
                    '__data__': {
                        "index_id": self.dataset.id,
                        "summary": None,
                        "table": {}
                    }
                }, cls=SetEncoder)
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
        # get set of ids that correspond to node
        node_idxs_to_delete = set(ids)

        # delete node_idxs from keyword to node idxs mapping
        keywords_to_delete = set()
        for keyword, node_idxs in keyword_table.items():
            if node_idxs_to_delete.intersection(node_idxs):
                keyword_table[keyword] = node_idxs.difference(
                    node_idxs_to_delete
                )
                if not keyword_table[keyword]:
                    keywords_to_delete.add(keyword)

        for keyword in keywords_to_delete:
            del keyword_table[keyword]

        return keyword_table

    def _retrieve_ids_by_query(self, keyword_table: dict, query: str, k: int = 4):
        keyword_table_handler = JiebaKeywordTableHandler()
        keywords = keyword_table_handler.extract_keywords(query)

        # go through text chunks in order of most matching keywords
        chunk_indices_count: dict[str, int] = defaultdict(int)
        keywords = [keyword for keyword in keywords if keyword in set(keyword_table.keys())]
        for keyword in keywords:
            for node_id in keyword_table[keyword]:
                chunk_indices_count[node_id] += 1

        sorted_chunk_indices = sorted(
            list(chunk_indices_count.keys()),
            key=lambda x: chunk_indices_count[x],
            reverse=True,
        )

        return sorted_chunk_indices[: k]

    def _update_segment_keywords(self, dataset_id: str, node_id: str, keywords: list[str]):
        document_segment = db.session.query(DocumentSegment).filter(
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.index_node_id == node_id
        ).first()
        if document_segment:
            document_segment.keywords = keywords
            db.session.add(document_segment)
            db.session.commit()

    def create_segment_keywords(self, node_id: str, keywords: list[str]):
        keyword_table = self._get_dataset_keyword_table()
        self._update_segment_keywords(self.dataset.id, node_id, keywords)
        keyword_table = self._add_text_to_keyword_table(keyword_table, node_id, keywords)
        self._save_dataset_keyword_table(keyword_table)

    def multi_create_segment_keywords(self, pre_segment_data_list: list):
        keyword_table_handler = JiebaKeywordTableHandler()
        keyword_table = self._get_dataset_keyword_table()
        for pre_segment_data in pre_segment_data_list:
            segment = pre_segment_data['segment']
            if pre_segment_data['keywords']:
                segment.keywords = pre_segment_data['keywords']
                keyword_table = self._add_text_to_keyword_table(keyword_table, segment.index_node_id,
                                                                pre_segment_data['keywords'])
            else:
                keywords = keyword_table_handler.extract_keywords(segment.content,
                                                                  self._config.max_keywords_per_chunk)
                segment.keywords = list(keywords)
                keyword_table = self._add_text_to_keyword_table(keyword_table, segment.index_node_id, list(keywords))
        self._save_dataset_keyword_table(keyword_table)

    def update_segment_keywords_index(self, node_id: str, keywords: list[str]):
        keyword_table = self._get_dataset_keyword_table()
        keyword_table = self._add_text_to_keyword_table(keyword_table, node_id, keywords)
        self._save_dataset_keyword_table(keyword_table)


class SetEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, set):
            return list(obj)
        return super().default(obj)
