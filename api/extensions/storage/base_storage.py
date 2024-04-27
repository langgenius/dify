"""Abstract interface for file storage implementations."""
from abc import ABC, abstractmethod
from collections.abc import Generator


class BaseStorage(ABC):
    """Interface for file storage.
    """
    storage_type = None
    app_config = None
    folder = None

    def __init__(self, storage_type, app_config, folder=None):
        self.storage_type = storage_type
        self.app_config = app_config
        self.folder = folder

    @abstractmethod
    def save(self, filename, data):
        raise NotImplementedError

    @abstractmethod
    def load_once(self, filename: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    def load_stream(self, filename: str) -> Generator:
        raise NotImplementedError

    @abstractmethod
    def download(self, filename, target_filepath):
        raise NotImplementedError

    @abstractmethod
    def exists(self, filename):
        raise NotImplementedError

    @abstractmethod
    def delete(self, filename):
        raise NotImplementedError
