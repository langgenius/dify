class DocumentExtractorError(Exception):
    """Base exception for errors related to the DocumentExtractorNode."""


class FileDownloadError(DocumentExtractorError):
    """Exception raised when there's an error downloading a file."""


class UnsupportedFileTypeError(DocumentExtractorError):
    """Exception raised when trying to extract text from an unsupported file type."""


class TextExtractionError(DocumentExtractorError):
    """Exception raised when there's an error during text extraction from a file."""
