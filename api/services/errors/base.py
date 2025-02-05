from typing import Optional


class BaseServiceError(ValueError):
    def __init__(self, description: Optional[str] = None):
        self.description = description
