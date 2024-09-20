"""Abstract interface for document cleaner implementations."""

from abc import ABC, abstractmethod


class BaseCleaner(ABC):
    """Interface for clean chunk content."""

    @abstractmethod
    def clean(self, content: str):
        raise NotImplementedError
