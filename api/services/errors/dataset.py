from services.errors.base import BaseServiceError


class DatasetNameDuplicateError(BaseServiceError):
    pass


class DatasetInUseError(BaseServiceError):
    pass


class DatasetIndexingInProgressError(BaseServiceError):
    """Raised when deleting a dataset would race with active document indexing."""

    def __init__(self):
        super().__init__(
            "The knowledge base has documents that are still indexing. Wait for indexing to finish before deleting it."
        )
