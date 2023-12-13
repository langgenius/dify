"""Wrapper around Jina embedding models."""
from typing import Any, List

import requests
from pydantic import BaseModel, Extra

from langchain.embeddings.base import Embeddings


class JinaEmbeddings(BaseModel, Embeddings):
    """Wrapper around Jina embedding models.
    """

    client: Any  #: :meta private:
    api_key: str
    model: str

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Call out to Jina's embedding endpoint.

        Args:
            texts: The list of texts to embed.

        Returns:
            List of embeddings, one for each text.
        """
        embeddings = []
        for text in texts:
            result = self.invoke_embedding(text=text)
            embeddings.append(result)

        return [list(map(float, e)) for e in embeddings]

    def invoke_embedding(self, text):
        params = {
            "model": self.model,
            "input": [
                text
            ]
        }

        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}
        response = requests.post(
            'https://api.jina.ai/v1/embeddings',
            headers=headers,
            json=params
        )

        if not response.ok:
            raise ValueError(f"Jina HTTP {response.status_code} error: {response.text}")

        json_response = response.json()
        return json_response["data"][0]["embedding"]

    def embed_query(self, text: str) -> List[float]:
        """Call out to Jina's embedding endpoint.

        Args:
            text: The text to embed.

        Returns:
            Embeddings for the text.
        """
        return self.embed_documents([text])[0]
