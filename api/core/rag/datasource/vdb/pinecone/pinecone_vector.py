import json
import logging
from typing import Any

from pinecone.grpc import GRPCIndex
from pinecone.grpc import PineconeGRPC as Pinecone
from pydantic import BaseModel

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class PineconeConfig(BaseModel):
    index: str
    index_dimension: int
    api_key: str


class PineconeVector(BaseVector):
    def __init__(self, collection_name: str, config: PineconeConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._client = Pinecone(
            api_key=config.api_key,
        )

    def get_type(self) -> str:
        return VectorType.PINECONE

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        if not texts:
            return

        self.add_texts(texts, embeddings, **kwargs)

    def _get_pinecone_index(self) -> GRPCIndex:
        if not self._client.has_index(self._client_config.index):
            raise ValueError("You must create a pinecone index first.")
        return self._client.Index(self._client_config.index)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        uuids = self._get_uuids(documents)
        metadatas = []
        for document in documents:
            metadata = document.metadata
            metadata.update({"page_content": document.page_content})
            metadatas.append(metadata)

        vectors = []
        for index, document in enumerate(documents):
            embedding = self._pad_vector(embeddings[index])
            vectors.append((uuids[index], embedding, metadatas[index]))

        pindex = self._get_pinecone_index()
        pindex.upsert(vectors=vectors, namespace=self.collection_name, batch_size=len(vectors))

    def delete_by_metadata_field(self, key: str, value: str):
        pindex = self._get_pinecone_index()
        pindex.delete(filter={key: {"$eq": value}}, namespace=self.collection_name)

    def delete(self):
        pindex = self._get_pinecone_index()
        pindex.delete(namespace=self._collection_name, delete_all=True)

    def delete_by_ids(self, ids: list[str]) -> None:
        pindex = self._get_pinecone_index()
        pindex.delete(ids=ids, namespace=self.collection_name)

    def text_exists(self, id: str) -> bool:
        pindex = self._get_pinecone_index()
        response = pindex.query(id=id, namespace=self.collection_name, top_k=1)
        return len(response["matches"]) > 0

    def _pad_vector(self, vector: list[float]) -> list[float]:
        vector_length = len(vector)
        if vector_length == self._client_config.index_dimension:
            return vector
        if vector_length > self._client_config.index_dimension:
            return vector[: self._client_config.index_dimension]
        return vector + [0.0] * (self._client_config.index_dimension - vector_length)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        query_vector = self._pad_vector(query_vector)

        pindex = self._get_pinecone_index()
        result = pindex.query(
            vector=query_vector,
            top_k=kwargs.get("top_k", 4),
            namespace=self.collection_name,
            include_metadata=True,
        )
        score_threshold = float(kwargs.get("score_threshold") or 0.0)

        matches = result["matches"]
        ids: list[str] = []
        metadatas: list[dict[str, Any]] = []
        scores: list[float] = []
        for match in matches:
            ids.append(match["id"])
            metadatas.append(match["metadata"])
            scores.append(match["score"])

        docs = []
        for index in range(len(ids)):
            score = scores[index]
            metadata = metadatas[index]
            if score >= score_threshold:
                metadata["score"] = score
                doc = Document(
                    page_content=metadata["page_content"],
                    metadata=metadata,
                )
                docs.append(doc)
        # Sort the documents by score in descending order
        docs = sorted(docs, key=lambda x: x.metadata["score"], reverse=True)
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # Pinecone does not support BM25 full text searching
        return []


class PineconeVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> BaseVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            index_struct_dict = {"type": VectorType.PINECONE, "vector_store": {"class_prefix": collection_name}}
            dataset.index_struct = json.dumps(index_struct_dict)

        return PineconeVector(
            collection_name=collection_name,
            config=PineconeConfig(
                api_key=dify_config.PINECONE_API_KEY,
                index=dify_config.PINECONE_INDEX,
                index_dimension=dify_config.PINECONE_INDEX_DIMENSION,
            ),
        )
