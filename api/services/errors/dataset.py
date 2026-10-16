from services.errors.base import BaseServiceError


class DatasetNameDuplicateError(BaseServiceError):
    pass


class DatasetAccessError(Exception):
    """Base class for framework-neutral dataset access failures."""


class DatasetNotFoundError(DatasetAccessError):
    def __init__(self) -> None:
        super().__init__("Dataset not found")


class DatasetAccessDeniedError(DatasetAccessError):
    def __init__(self) -> None:
        super().__init__("You do not have permission to access this dataset")


class DatasetInUseError(BaseServiceError):
    pass
