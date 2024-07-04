from libs.exception import BaseHTTPException


class ApiKeyAuthFailedError(BaseHTTPException):
    error_code = 'auth_failed'
    description = "{message}"
    code = 500


class InvalidEmailError(BaseHTTPException):
    error_code = 'invalid_email'
    description = "The email address is not valid."
    code = 400


class PasswordMismatchError(BaseHTTPException):
    error_code = 'password_mismatch'
    description = "The passwords do not match."
    code = 400


class InvalidTokenError(BaseHTTPException):
    error_code = 'invalid_or_expired_token'
    description = "The token is invalid or has expired."
    code = 400


class PasswordResetRateLimitExceededError(BaseHTTPException):
    error_code = 'password_reset_rate_limit_exceeded'
    description = "Password reset rate limit exceeded. Try again later."
    code = 429

