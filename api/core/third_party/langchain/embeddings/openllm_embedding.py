"""Wrapper around OpenLLM embedding models."""
from typing import Any, List, Optional

import requests
from pydantic import BaseModel, Extra

from langchain.embeddings.base import Embeddings


class OpenLLMEmbeddings(BaseModel, Embeddings):
    """Wrapper around OpenLLM embedding models.
    """

    client: Any  #: :meta private:

    server_url: Optional[str] = None
    """Optional server URL that currently runs a LLMServer with 'openllm start'."""

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Call out to OpenLLM's embedding endpoint.

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
        params = [
            text
        ]

        headers = {"Content-Type": "application/json"}
        response = requests.post(
            f'{self.server_url}/v1/embeddings',
            headers=headers,
            json=params
        )

        if not response.ok:
            raise ValueError(f"OpenLLM HTTP {response.status_code} error: {response.text}")

        json_response = response.json()
        return json_response[0]["embeddings"][0]

    def embed_query(self, text: str) -> List[float]:
        """Call out to OpenLLM's embedding endpoint.

        Args:
            text: The text to embed.

        Returns:
            Embeddings for the text.
        """
        return self.embed_documents([text])[0]
