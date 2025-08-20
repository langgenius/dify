from services.errors.base import BaseServiceError


class FileNotExistsError(BaseServiceError):
    pass


class FileTooLargeError(BaseServiceError):
    description = "{message}"


class UnsupportedFileTypeError(BaseServiceError):
    pass


class UploadQueueFullError(Exception):
    """Raised when upload queue is full."""
    description = "Upload queue is full. Please try again later."
