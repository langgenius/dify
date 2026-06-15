class BaseServiceError(ValueError):
    def __init__(self, description: str = ""):
        self.description = description
