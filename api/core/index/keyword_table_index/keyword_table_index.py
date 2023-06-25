import json
from collections import defaultdict
from typing import Any, List, Optional, Dict

from langchain.schema import Document, BaseRetriever
from pydantic import BaseModel, Field, Extra

from core.index.base import BaseIndex
from core.index.keyword_table_index.jieba_keyword_table_handler import JiebaKeywordTableHandler
from extensions.ext_database import db
from models.dataset import Dataset, DocumentSegment, DatasetKeywordTable


class KeywordTableConfig(BaseModel):
    max_keywords_per_chunk: int = 10


class KeywordTableIndex(BaseIndex):
    def __init__(self, dataset: Dataset, config: KeywordTableConfig = KeywordTableConfig()):
        super().__init__(dataset)
        self._config = config

    def create(self, texts: list[Document], **kwargs) -> BaseIndex:
        keyword_table_handler = JiebaKeywordTableHandler()
        keyword_table = {}
        for text in texts:
            keywords = keyword_table_handler.extract_keywords(text.page_content, self._config.max_keywords_per_chunk)
            self._update_segment_keywords(text.metadata['doc_id'], list(keywords))
            keyword_table = self._add_text_to_keyword_table(keyword_table, text.metadata['doc_id'], list(keywords))

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

        self._save_dataset_keyword_table(keyword_table)

        return self

    def add_texts(self, texts: list[Document], **kwargs):
        keyword_table_handler = JiebaKeywordTableHandler()

        keyword_table = self._get_dataset_keyword_table()
        for text in texts:
            keywords = keyword_table_handler.extract_keywords(text.page_content, self._config.max_keywords_per_chunk)
            self._update_segment_keywords(text.metadata['doc_id'], list(keywords))
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

        ids = [segment.id for segment in segments]

        keyword_table = self._get_dataset_keyword_table()
        keyword_table = self._delete_ids_from_keyword_table(keyword_table, ids)

        self._save_dataset_keyword_table(keyword_table)

    def get_retriever(self, **kwargs: Any) -> BaseRetriever:
        return KeywordTableRetriever(index=self, **kwargs)

    def search(
            self, query: str,
            **kwargs: Any
    ) -> List[Document]:
        keyword_table = self._get_dataset_keyword_table()

        search_kwargs = kwargs.get('search_kwargs') if kwargs.get('search_kwargs') else {}
        k = search_kwargs.get('k') if search_kwargs.get('k') else 4

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
        chunk_indices_count: Dict[str, int] = defaultdict(int)
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

    def _update_segment_keywords(self, node_id: str, keywords: List[str]):
        document_segment = db.session.query(DocumentSegment).filter(DocumentSegment.index_node_id == node_id).first()
        if document_segment:
            document_segment.keywords = keywords
            db.session.commit()


class KeywordTableRetriever(BaseRetriever, BaseModel):
    index: KeywordTableIndex
    search_kwargs: dict = Field(default_factory=dict)

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid
        arbitrary_types_allowed = True

    def get_relevant_documents(self, query: str) -> List[Document]:
        """Get documents relevant for a query.

        Args:
            query: string to find relevant documents for

        Returns:
            List of relevant documents
        """
        return self.index.search(query, **self.search_kwargs)

    async def aget_relevant_documents(self, query: str) -> List[Document]:
        raise NotImplementedError("KeywordTableRetriever does not support async")


class SetEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, set):
            return list(obj)
        return super().default(obj)
