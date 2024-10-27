from abc import ABC, abstractmethod


class ApiKeyAuthBase(ABC):
    def __init__(self, credentials: dict):
        self.credentials = credentials

    @abstractmethod
    def validate_credentials(self):
        raise NotImplementedError
