from services.errors.base import BaseServiceError


class DatasetNotFoundError(Exception):
    """The requested dataset is unavailable."""


class DatasetNameDuplicateError(BaseServiceError):
    pass


class DatasetInUseError(BaseServiceError):
    pass
