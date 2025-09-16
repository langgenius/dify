class BaseServiceError(ValueError):
    def __init__(self, description: str | None = None):
        self.description = description
