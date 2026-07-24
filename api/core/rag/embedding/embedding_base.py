from abc import ABC, abstractmethod


class Embeddings(ABC):
    """Interface for embedding models."""

    @abstractmethod
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Embed search docs."""
        raise NotImplementedError

    @abstractmethod
    def embed_multimodal_documents(self, multimodel_documents: list[dict]) -> list[list[float]]:
        """Embed file documents."""
        raise NotImplementedError

    @abstractmethod
    def embed_query(self, text: str) -> list[float]:
        """Embed query text."""
        raise NotImplementedError

    @abstractmethod
    def embed_multimodal_query(self, multimodel_document: dict) -> list[float]:
        """Embed multimodal query."""
        raise NotImplementedError

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        """Asynchronous Embed search docs."""
        raise NotImplementedError

    async def aembed_query(self, text: str) -> list[float]:
        """Asynchronous Embed query text."""
        raise NotImplementedError
