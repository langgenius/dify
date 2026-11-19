from collections.abc import Iterable

from services.errors.base import BaseServiceError


class FileNotExistsError(BaseServiceError):
    pass


class FileTooLargeError(BaseServiceError):
    description = "{message}"


class UnsupportedFileTypeError(BaseServiceError):
    pass


class BlockedFileExtensionError(BaseServiceError):
    description = "File extension '{extension}' is not allowed for security reasons"


class UploadFileReferenceNotFoundError(ValueError):
    """Raised when a tenant does not own every file an owner will reference."""

    def __init__(self, missing_file_ids: Iterable[str]) -> None:
        self.missing_file_ids = tuple(sorted(set(missing_file_ids)))
        super().__init__(f"Upload files no longer exist: {list(self.missing_file_ids)}")
