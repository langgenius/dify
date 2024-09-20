"""Abstract interface for file storage implementations."""

from abc import ABC, abstractmethod
from collections.abc import Generator

from flask import Flask


class BaseStorage(ABC):
    """Interface for file storage."""

    app = None

    def __init__(self, app: Flask):
        self.app = app

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
