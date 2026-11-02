class BaseServiceError(ValueError):
    def __init__(self, description: str = ""):
        self.description = description


class NoPermissionError(Exception):
    """The actor is not permitted to perform the requested operation."""
