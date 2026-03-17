"""Abstract interface for document loader implementations."""

from abc import ABC, abstractmethod

from core.rag.models.document import Document


class BaseExtractor(ABC):
    """Interface for extract files."""

    @abstractmethod
    def extract(self) -> list[Document]:
        raise NotImplementedError
