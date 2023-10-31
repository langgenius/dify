from typing import List, Optional, Any

import numpy as np
from langchain.embeddings.base import Embeddings
from xinference_client.client.restful.restful_client import Client


class XinferenceEmbeddings(Embeddings):
    client: Any
    server_url: Optional[str]
    """URL of the xinference server"""
    model_uid: Optional[str]
    """UID of the launched model"""

    def __init__(
            self, server_url: Optional[str] = None, model_uid: Optional[str] = None
    ):

        super().__init__()

        if server_url is None:
            raise ValueError("Please provide server URL")

        if model_uid is None:
            raise ValueError("Please provide the model UID")

        self.server_url = server_url

        self.model_uid = model_uid

        self.client = Client(server_url)

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        model = self.client.get_model(self.model_uid)

        embeddings = [
            model.create_embedding(text)["data"][0]["embedding"] for text in texts
        ]
        vectors = [list(map(float, e)) for e in embeddings]
        normalized_vectors = [(vector / np.linalg.norm(vector)).tolist() for vector in vectors]

        return normalized_vectors

    def embed_query(self, text: str) -> List[float]:
        model = self.client.get_model(self.model_uid)

        embedding_res = model.create_embedding(text)

        embedding = embedding_res["data"][0]["embedding"]

        vector = list(map(float, embedding))
        normalized_vector = (vector / np.linalg.norm(vector)).tolist()

        return normalized_vector
