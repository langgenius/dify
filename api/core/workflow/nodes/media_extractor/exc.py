class MediaExtractorError(Exception):
    """Base exception for errors related to the DocumentExtractorNode."""


class FileDownloadError(MediaExtractorError):
    """Exception raised when there's an error downloading a file."""


class UnsupportedFileTypeError(MediaExtractorError):
    """Exception raised when trying to extract text from an unsupported file type."""


class TextExtractionError(MediaExtractorError):
    """Exception raised when there's an error during text extraction from a file."""
