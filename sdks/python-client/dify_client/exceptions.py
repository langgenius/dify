"""Custom exceptions for the Dify client."""

from typing import Optional, Dict, Any


class DifyClientError(Exception):
    """Base exception for all Dify client errors."""
    
    def __init__(self, message: str, status_code: Optional[int] = None, response: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.response = response


class APIError(DifyClientError):
    """Raised when the API returns an error response."""
    
    def __init__(self, message: str, status_code: int, response: Optional[Dict[str, Any]] = None):
        super().__init__(message, status_code, response)
        self.status_code = status_code


class AuthenticationError(DifyClientError):
    """Raised when authentication fails."""
    pass


class RateLimitError(DifyClientError):
    """Raised when rate limit is exceeded."""
    
    def __init__(self, message: str = "Rate limit exceeded", retry_after: Optional[int] = None):
        super().__init__(message)
        self.retry_after = retry_after


class ValidationError(DifyClientError):
    """Raised when request validation fails."""
    pass


class NetworkError(DifyClientError):
    """Raised when network-related errors occur."""
    pass


class TimeoutError(DifyClientError):
    """Raised when request times out."""
    pass


class FileUploadError(DifyClientError):
    """Raised when file upload fails."""
    pass


class DatasetError(DifyClientError):
    """Raised when dataset operations fail."""
    pass


class WorkflowError(DifyClientError):
    """Raised when workflow operations fail."""
    pass