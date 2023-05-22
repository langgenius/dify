import json
import logging
from typing import List, Optional

from llama_index.data_structs import Node
from requests import ReadTimeout
from sqlalchemy.exc import IntegrityError
from tenacity import retry, stop_after_attempt, retry_if_exception_type

from core.index.index_builder import IndexBuilder
from core.vector_store.base import BaseGPTVectorStoreIndex
from extensions.ext_vector_store import vector_store
from extensions.ext_database import db
from models.dataset import Dataset, Embedding


class VectorIndex:

    def __init__(self, dataset: Dataset):
        self._dataset = dataset

    def add_nodes(self, nodes: List[Node], duplicate_check: bool = False):
        if not self._dataset.index_struct_dict:
            index_id = "Vector_index_" + self._dataset.id.replace("-", "_")
            self._dataset.index_struct = json.dumps(vector_store.to_index_struct(index_id))
            db.session.commit()

        service_context = IndexBuilder.get_default_service_context(tenant_id=self._dataset.tenant_id)

        index = vector_store.get_index(
            service_context=service_context,
            index_struct=self._dataset.index_struct_dict
        )

        if duplicate_check:
            nodes = self._filter_duplicate_nodes(index, nodes)

        embedding_queue_nodes = []
        embedded_nodes = []
        for node in nodes:
            node_hash = node.doc_hash

            # if node hash in cached embedding tables, use cached embedding
            embedding = db.session.query(Embedding).filter_by(hash=node_hash).first()
            if embedding:
                node.embedding = embedding.get_embedding()
                embedded_nodes.append(node)
            else:
                embedding_queue_nodes.append(node)

        if embedding_queue_nodes:
            embedding_results = index._get_node_embedding_results(
                embedding_queue_nodes,
                set(),
            )

            # pre embed nodes for cached embedding
            for embedding_result in embedding_results:
                node = embedding_result.node
                node.embedding = embedding_result.embedding

                try:
                    embedding = Embedding(hash=node.doc_hash)
                    embedding.set_embedding(node.embedding)
                    db.session.add(embedding)
                    db.session.commit()
                except IntegrityError:
                    db.session.rollback()
                    continue
                except:
                    logging.exception('Failed to add embedding to db')
                    continue

                embedded_nodes.append(node)

        self.index_insert_nodes(index, embedded_nodes)

    @retry(reraise=True, retry=retry_if_exception_type(ReadTimeout), stop=stop_after_attempt(3))
    def index_insert_nodes(self, index: BaseGPTVectorStoreIndex, nodes: List[Node]):
        index.insert_nodes(nodes)

    def del_nodes(self, node_ids: List[str]):
        if not self._dataset.index_struct_dict:
            return

        service_context = IndexBuilder.get_fake_llm_service_context(tenant_id=self._dataset.tenant_id)

        index = vector_store.get_index(
            service_context=service_context,
            index_struct=self._dataset.index_struct_dict
        )

        for node_id in node_ids:
            self.index_delete_node(index, node_id)

    @retry(reraise=True, retry=retry_if_exception_type(ReadTimeout), stop=stop_after_attempt(3))
    def index_delete_node(self, index: BaseGPTVectorStoreIndex, node_id: str):
        index.delete_node(node_id)

    def del_doc(self, doc_id: str):
        if not self._dataset.index_struct_dict:
            return

        service_context = IndexBuilder.get_fake_llm_service_context(tenant_id=self._dataset.tenant_id)

        index = vector_store.get_index(
            service_context=service_context,
            index_struct=self._dataset.index_struct_dict
        )

        self.index_delete_doc(index, doc_id)

    @retry(reraise=True, retry=retry_if_exception_type(ReadTimeout), stop=stop_after_attempt(3))
    def index_delete_doc(self, index: BaseGPTVectorStoreIndex, doc_id: str):
        index.delete(doc_id)

    @property
    def query_index(self) -> Optional[BaseGPTVectorStoreIndex]:
        if not self._dataset.index_struct_dict:
            return None

        service_context = IndexBuilder.get_default_service_context(tenant_id=self._dataset.tenant_id)

        return vector_store.get_index(
            service_context=service_context,
            index_struct=self._dataset.index_struct_dict
        )

    def _filter_duplicate_nodes(self, index: BaseGPTVectorStoreIndex, nodes: List[Node]) -> List[Node]:
        for node in nodes:
            node_id = node.doc_id
            exists_duplicate_node = index.exists_by_node_id(node_id)
            if exists_duplicate_node:
                nodes.remove(node)

        return nodes
