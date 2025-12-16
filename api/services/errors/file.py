from services.errors.base import BaseServiceError


class FileNotExistsError(BaseServiceError):
    pass


class FileTooLargeError(BaseServiceError):
    description = "{message}"


class UnsupportedFileTypeError(BaseServiceError):
    pass


class BlockedFileExtensionError(BaseServiceError):
    description = "File extension '{extension}' is not allowed for security reasons"
