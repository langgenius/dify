import json
from typing import List, Optional

from llama_index import ServiceContext, LLMPredictor, OpenAIEmbedding
from llama_index.data_structs import KeywordTable, Node
from llama_index.indices.keyword_table.base import BaseGPTKeywordTableIndex
from llama_index.indices.registry import load_index_struct_from_dict

from core.docstore.dataset_docstore import DatesetDocumentStore
from core.docstore.empty_docstore import EmptyDocumentStore
from core.index.index_builder import IndexBuilder
from core.index.keyword_table.jieba_keyword_table import GPTJIEBAKeywordTableIndex
from core.llm.llm_builder import LLMBuilder
from extensions.ext_database import db
from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment


class KeywordTableIndex:

    def __init__(self, dataset: Dataset):
        self._dataset = dataset

    def add_nodes(self, nodes: List[Node]):
        llm = LLMBuilder.to_llm(
            tenant_id=self._dataset.tenant_id,
            model_name='fake'
        )

        service_context = ServiceContext.from_defaults(
            llm_predictor=LLMPredictor(llm=llm),
            embed_model=OpenAIEmbedding()
        )

        dataset_keyword_table = self.get_keyword_table()
        if not dataset_keyword_table or not dataset_keyword_table.keyword_table_dict:
            index_struct = KeywordTable()
        else:
            index_struct_dict = dataset_keyword_table.keyword_table_dict
            index_struct: KeywordTable = load_index_struct_from_dict(index_struct_dict)

        # create index
        index = GPTJIEBAKeywordTableIndex(
            index_struct=index_struct,
            docstore=EmptyDocumentStore(),
            service_context=service_context
        )

        for node in nodes:
            keywords = index._extract_keywords(node.get_text())
            self.update_segment_keywords(node.doc_id, list(keywords))
            index._index_struct.add_node(list(keywords), node)

        index_struct_dict = index.index_struct.to_dict()

        if not dataset_keyword_table:
            dataset_keyword_table = DatasetKeywordTable(
                dataset_id=self._dataset.id,
                keyword_table=json.dumps(index_struct_dict)
            )
            db.session.add(dataset_keyword_table)
        else:
            dataset_keyword_table.keyword_table = json.dumps(index_struct_dict)

        db.session.commit()

    def del_nodes(self, node_ids: List[str]):
        llm = LLMBuilder.to_llm(
            tenant_id=self._dataset.tenant_id,
            model_name='fake'
        )

        service_context = ServiceContext.from_defaults(
            llm_predictor=LLMPredictor(llm=llm),
            embed_model=OpenAIEmbedding()
        )

        dataset_keyword_table = self.get_keyword_table()
        if not dataset_keyword_table or not dataset_keyword_table.keyword_table_dict:
            return
        else:
            index_struct_dict = dataset_keyword_table.keyword_table_dict
            index_struct: KeywordTable = load_index_struct_from_dict(index_struct_dict)

        # create index
        index = GPTJIEBAKeywordTableIndex(
            index_struct=index_struct,
            docstore=EmptyDocumentStore(),
            service_context=service_context
        )

        for node_id in node_ids:
            index.delete(node_id)

        index_struct_dict = index.index_struct.to_dict()

        if not dataset_keyword_table:
            dataset_keyword_table = DatasetKeywordTable(
                dataset_id=self._dataset.id,
                keyword_table=json.dumps(index_struct_dict)
            )
            db.session.add(dataset_keyword_table)
        else:
            dataset_keyword_table.keyword_table = json.dumps(index_struct_dict)

        db.session.commit()

    @property
    def query_index(self) -> Optional[BaseGPTKeywordTableIndex]:
        docstore = DatesetDocumentStore(
            dataset=self._dataset,
            user_id=self._dataset.created_by,
            embedding_model_name="text-embedding-ada-002"
        )

        service_context = IndexBuilder.get_default_service_context(tenant_id=self._dataset.tenant_id)

        dataset_keyword_table = self.get_keyword_table()
        if not dataset_keyword_table or not dataset_keyword_table.keyword_table_dict:
            return None

        index_struct: KeywordTable = load_index_struct_from_dict(dataset_keyword_table.keyword_table_dict)

        return GPTJIEBAKeywordTableIndex(index_struct=index_struct, docstore=docstore, service_context=service_context)

    def get_keyword_table(self):
        dataset_keyword_table = self._dataset.dataset_keyword_table
        if dataset_keyword_table:
            return dataset_keyword_table
        return None

    def update_segment_keywords(self, node_id: str, keywords: List[str]):
        document_segment = db.session.query(DocumentSegment).filter(DocumentSegment.index_node_id == node_id).first()
        if document_segment:
            document_segment.keywords = keywords
            db.session.commit()
