from services.errors.base import BaseServiceError


class ChildChunkIndexingError(BaseServiceError):
    description = "{message}"


class ChildChunkDeleteIndexError(BaseServiceError):
    description = "{message}"
