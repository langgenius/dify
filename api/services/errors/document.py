from services.errors.base import BaseServiceError


class DocumentNotFoundError(Exception):
    """The requested document is unavailable."""


class DocumentSourceNotFoundError(Exception):
    """A document has no available source file for download."""


class DocumentAccessDeniedError(Exception):
    """The actor cannot access the document's dataset."""


class DocumentIndexingError(BaseServiceError):
    pass
