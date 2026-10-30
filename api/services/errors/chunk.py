from services.errors.base import BaseServiceError


class ChildChunkIndexingError(BaseServiceError):
    description = "{message}"
