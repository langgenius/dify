"""Abstract interface for document loader implementations."""
from abc import ABC, abstractmethod
from typing import List

from core.rag.cleaner.cleaner_base import BaseCleaner
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from models.dataset import DatasetProcessRule


class BaseIndexProcessor(ABC):
    """Interface for extract files.
    """

    def __init__(self, file_path: str, process_rule: DatasetProcessRule):
        self._file_path = file_path
        self._process_rule = process_rule

    @abstractmethod
    def format(self, documents: List[Document]):
        pass

    @abstractmethod
    def load(self, source):
        pass

    @abstractmethod
    def retrieve(self):
        pass