class BaseServiceError(Exception):
    def __init__(self, description: str = None):
        self.description = description
