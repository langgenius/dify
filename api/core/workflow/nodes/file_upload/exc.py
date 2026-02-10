class FileUploadNodeError(ValueError):
    """Base exception for errors related to the FileUploadNode."""


class FileUploadDownloadError(FileUploadNodeError):
    """Exception raised when preparing file download in sandbox fails."""
