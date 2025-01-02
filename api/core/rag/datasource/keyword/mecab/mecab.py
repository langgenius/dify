import json
import logging
from typing import Any, Optional
from collections import defaultdict

from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.datasource.keyword.mecab.mecab_keyword_table_handler import MeCabKeywordTableHandler
from core.rag.datasource.keyword.mecab.config import MeCabConfig
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
        self._keyword_handler = None
        self._init_handler()
    
    def _init_handler(self):
        """Initialize MeCab handler with configuration."""
        try:
            self._keyword_handler = MeCabKeywordTableHandler(
                dictionary_path=self._config.dictionary_path,
                user_dictionary_path=self._config.user_dictionary_path
            )
            if self._config.pos_weights:
                self._keyword_handler.pos_weights = self._config.pos_weights
                self._keyword_handler.min_score = self._config.score_threshold
        except Exception as e:
            logger.error(f"Failed to initialize MeCab handler: {str(e)}")
            raise KeywordProcessorError(f"MeCab initialization failed: {str(e)}")
    
    def create(self, texts: list[Document], **kwargs) -> BaseKeyword:
        """Create keyword index for documents."""
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            keyword_table = self._get_dataset_keyword_table()
            
            for text in texts:
                keywords = self._keyword_handler.extract_keywords(
                    text.page_content,
                    self._config.max_keywords_per_chunk
                )
                if text.metadata is not None:
                    self._update_segment_keywords(
                        self.dataset.id,
                        text.metadata["doc_id"],
                        list(keywords)
                    )
                    keyword_table = self._add_text_to_keyword_table(
                        keyword_table or {},
                        text.metadata["doc_id"],
                        list(keywords)
                    )
            
            self._save_dataset_keyword_table(keyword_table)
            return self
    
    def add_texts(self, texts: list[Document], **kwargs):
        """Add new texts to existing index."""
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            keyword_table = self._get_dataset_keyword_table()
            keywords_list = kwargs.get("keywords_list")
            
            for i, text in enumerate(texts):
                if keywords_list:
                    keywords = keywords_list[i]
                    if not keywords:
                        keywords = self._keyword_handler.extract_keywords(
                            text.page_content,
                            self._config.max_keywords_per_chunk
                        )
                else:
                    keywords = self._keyword_handler.extract_keywords(
                        text.page_content,
                        self._config.max_keywords_per_chunk
                    )
                
                if text.metadata is not None:
                    self._update_segment_keywords(
                        self.dataset.id,
                        text.metadata["doc_id"],
                        list(keywords)
                    )
                    keyword_table = self._add_text_to_keyword_table(
                        keyword_table or {},
                        text.metadata["doc_id"],
                        list(keywords)
                    )
            
            self._save_dataset_keyword_table(keyword_table)
    
    def text_exists(self, id: str) -> bool:
        """Check if text exists in index."""
        keyword_table = self._get_dataset_keyword_table()
        if keyword_table is None:
            return False
        return id in set.union(*keyword_table.values()) if keyword_table else False
    
    def delete_by_ids(self, ids: list[str]) -> None:
        """Delete texts by IDs."""
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            keyword_table = self._get_dataset_keyword_table()
            if keyword_table is not None:
                keyword_table = self._delete_ids_from_keyword_table(keyword_table, ids)
            self._save_dataset_keyword_table(keyword_table)
    
    def delete(self) -> None:
        """Delete entire index."""
        lock_name = f"keyword_indexing_lock_{self.dataset.id}"
        with redis_client.lock(lock_name, timeout=600):
            dataset_keyword_table = self.dataset.dataset_keyword_table
            if dataset_keyword_table:
                db.session.delete(dataset_keyword_table)
                db.session.commit()
                if dataset_keyword_table.data_source_type != "database":
                    file_key = f"keyword_files/{self.dataset.tenant_id}/{self.dataset.id}.txt"
                    storage.delete(file_key)
    
    def search(self, query: str, **kwargs: Any) -> list[Document]:
        """Search documents using keywords."""
        keyword_table = self._get_dataset_keyword_table()
        k = kwargs.get("top_k", 4)
        
        sorted_chunk_indices = self._retrieve_ids_by_query(
            keyword_table or {},
            query,
            k
        )
        
        documents = []
        for chunk_index in sorted_chunk_indices:
            segment = (
                db.session.query(DocumentSegment)
                .filter(
                    DocumentSegment.dataset_id == self.dataset.id,
                    DocumentSegment.index_node_id == chunk_index
                )
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
    
    def _get_dataset_keyword_table(self) -> Optional[dict]:
        """Get keyword table from storage."""
        dataset_keyword_table = self.dataset.dataset_keyword_table
        if dataset_keyword_table:
            keyword_table_dict = dataset_keyword_table.keyword_table_dict
            if keyword_table_dict:
                return dict(keyword_table_dict["__data__"]["table"])
        return {}
    
    def _save_dataset_keyword_table(self, keyword_table):
        """Save keyword table to storage."""
        table_dict = {
            "__type__": "keyword_table",
            "__data__": {
                "index_id": self.dataset.id,
                "summary": None,
                "table": keyword_table
            }
        }
        
        dataset_keyword_table = self.dataset.dataset_keyword_table
        data_source_type = dataset_keyword_table.data_source_type
        
        if data_source_type == "database":
            dataset_keyword_table.keyword_table = json.dumps(table_dict, cls=SetEncoder)
            db.session.commit()
        else:
            file_key = f"keyword_files/{self.dataset.tenant_id}/{self.dataset.id}.txt"
            if storage.exists(file_key):
                storage.delete(file_key)
            storage.save(
                file_key,
                json.dumps(table_dict, cls=SetEncoder).encode("utf-8")
            )
    
    def _add_text_to_keyword_table(self, keyword_table: dict, id: str, keywords: list[str]) -> dict:
        """Add text keywords to table."""
        for keyword in keywords:
            if keyword not in keyword_table:
                keyword_table[keyword] = set()
            keyword_table[keyword].add(id)
        return keyword_table
    
    def _delete_ids_from_keyword_table(self, keyword_table: dict, ids: list[str]) -> dict:
        """Delete IDs from keyword table."""
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
        """Retrieve document IDs by query."""
        keywords = self._keyword_handler.extract_keywords(query)
        
        # Score documents based on matching keywords
        chunk_indices_count = defaultdict(int)
        keywords_list = [
            keyword for keyword in keywords
            if keyword in set(keyword_table.keys())
        ]
        
        for keyword in keywords_list:
            for node_id in keyword_table[keyword]:
                chunk_indices_count[node_id] += 1
        
        sorted_chunk_indices = sorted(
            chunk_indices_count.keys(),
            key=lambda x: chunk_indices_count[x],
            reverse=True
        )
        
        return sorted_chunk_indices[:k]
    
    def _update_segment_keywords(self, dataset_id: str, node_id: str, keywords: list[str]):
        """Update segment keywords in database."""
        document_segment = (
            db.session.query(DocumentSegment)
            .filter(
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.index_node_id == node_id
            )
            .first()
        )
        
        if document_segment:
            document_segment.keywords = keywords
            db.session.add(document_segment)
            db.session.commit() 
