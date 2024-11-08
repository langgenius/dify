class HttpRequestNodeError(ValueError):
    """Custom error for HTTP request node."""


class AuthorizationConfigError(HttpRequestNodeError):
    """Raised when authorization config is missing or invalid."""


class FileFetchError(HttpRequestNodeError):
    """Raised when a file cannot be fetched."""


class InvalidHttpMethodError(HttpRequestNodeError):
    """Raised when an invalid HTTP method is used."""


class ResponseSizeError(HttpRequestNodeError):
    """Raised when the response size exceeds the allowed threshold."""
