from typing import List

import numpy as np
from langchain.embeddings import XinferenceEmbeddings


class XinferenceEmbedding(XinferenceEmbeddings):

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        vectors = super().embed_documents(texts)

        normalized_vectors = [(vector / np.linalg.norm(vector)).tolist() for vector in vectors]

        return normalized_vectors

    def embed_query(self, text: str) -> List[float]:
        vector = super().embed_query(text)

        normalized_vector = (vector / np.linalg.norm(vector)).tolist()

        return normalized_vector
