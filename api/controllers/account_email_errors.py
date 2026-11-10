"""Shared Account email HTTP errors, independent of surface initialization and handlers."""

from libs.exception import BaseHTTPException


class InvalidEmailError(BaseHTTPException):
    error_code = "invalid_email"
    description = "The email address is not valid."
    code = 400


class InvalidTokenError(BaseHTTPException):
    error_code = "invalid_or_expired_token"
    description = "The token is invalid or has expired."
    code = 400


class EmailChangeRateLimitExceededError(BaseHTTPException):
    error_code = "email_change_rate_limit_exceeded"
    description = "Too many email change emails have been sent. Please try again in {minutes} minutes."
    code = 429

    def __init__(self, minutes: int = 1):
        """Render the policy's retry interval while preserving the legacy one-minute default."""
        description = self.description.format(minutes=minutes) if self.description else None
        super().__init__(description=description)


class EmailCodeError(BaseHTTPException):
    error_code = "email_code_error"
    description = "Email code is invalid or expired."
    code = 400


class EmailChangeLimitError(BaseHTTPException):
    error_code = "email_change_limit"
    description = "Too many failed email change attempts. Please try again in 24 hours."
    code = 429


class EmailAlreadyInUseError(BaseHTTPException):
    error_code = "email_already_in_use"
    description = "A user with this email already exists."
    code = 400


class EmailSendIpLimitError(BaseHTTPException):
    error_code = "email_send_ip_limit"
    description = "Too many emails have been sent from this IP address recently. Please try again later."
    code = 429


class AccountInFreezeError(BaseHTTPException):
    error_code = "account_in_freeze"
    code = 400
    description = (
        "This email account has been deleted within the past 30 days "
        "and is temporarily unavailable for new account registration."
    )


class EmailDomainSuspendedError(BaseHTTPException):
    error_code = "email_domain_suspended"
    code = 400
    description = "This email domain has been suspended."
