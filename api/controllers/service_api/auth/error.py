from libs.exception import BaseHTTPException


class ApiKeyAuthFailedError(BaseHTTPException):
    error_code = "auth_failed"
    description = "{message}"
    code = 500


class InvalidEmailError(BaseHTTPException):
    error_code = "invalid_email"
    description = "The email address is not valid."
    code = 400


class PasswordMismatchError(BaseHTTPException):
    error_code = "password_mismatch"
    description = "The passwords do not match."
    code = 400


class InvalidTokenError(BaseHTTPException):
    error_code = "invalid_or_expired_token"
    description = "The token is invalid or has expired."
    code = 400


class PasswordResetRateLimitExceededError(BaseHTTPException):
    error_code = "password_reset_rate_limit_exceeded"
    description = "Too many password reset emails have been sent. Please try again in 1 minutes."
    code = 429


class EmailCodeError(BaseHTTPException):
    error_code = "email_code_error"
    description = "Email code is invalid or expired."
    code = 400


class EmailOrPasswordMismatchError(BaseHTTPException):
    error_code = "email_or_password_mismatch"
    description = "The email or password is mismatched."
    code = 400


class EmailPasswordLoginLimitError(BaseHTTPException):
    error_code = "email_code_login_limit"
    description = "Too many incorrect password attempts. Please try again later."
    code = 429


class EmailCodeLoginRateLimitExceededError(BaseHTTPException):
    error_code = "email_code_login_rate_limit_exceeded"
    description = "Too many login emails have been sent. Please try again in 5 minutes."
    code = 429


class EmailCodeAccountDeletionRateLimitExceededError(BaseHTTPException):
    error_code = "email_code_account_deletion_rate_limit_exceeded"
    description = "Too many account deletion emails have been sent. Please try again in 5 minutes."
    code = 429
