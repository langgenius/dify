from abc import ABC


class ApiKeyAuthBase(ABC):
    def __init__(self, credentials: dict):
        self.credentials = credentials

    def validate_credentials(self):
        raise NotImplementedError
