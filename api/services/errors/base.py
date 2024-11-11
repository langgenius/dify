from typing import Optional


class BaseServiceError(Exception):
    def __init__(self, description: Optional[str] = None):
        self.description = description
