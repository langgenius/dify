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
    description = "Too many password reset emails have been sent. Please try again in {minutes} minutes."
    code = 429

    def __init__(self, minutes: int = 1):
        description = self.description.format(minutes=int(minutes)) if self.description else None
        super().__init__(description=description)


class EmailRegisterRateLimitExceededError(BaseHTTPException):
    error_code = "email_register_rate_limit_exceeded"
    description = "Too many email register emails have been sent. Please try again in {minutes} minutes."
    code = 429

    def __init__(self, minutes: int = 1):
        description = self.description.format(minutes=int(minutes)) if self.description else None
        super().__init__(description=description)


class EmailChangeRateLimitExceededError(BaseHTTPException):
    error_code = "email_change_rate_limit_exceeded"
    description = "Too many email change emails have been sent. Please try again in {minutes} minutes."
    code = 429

    def __init__(self, minutes: int = 1):
        description = self.description.format(minutes=int(minutes)) if self.description else None
        super().__init__(description=description)


class OwnerTransferRateLimitExceededError(BaseHTTPException):
    error_code = "owner_transfer_rate_limit_exceeded"
    description = "Too many owner transfer emails have been sent. Please try again in {minutes} minutes."
    code = 429

    def __init__(self, minutes: int = 1):
        description = self.description.format(minutes=int(minutes)) if self.description else None
        super().__init__(description=description)


class EmailCodeError(BaseHTTPException):
    error_code = "email_code_error"
    description = "Email code is invalid or expired."
    code = 400


class EmailOrPasswordMismatchError(BaseHTTPException):
    error_code = "email_or_password_mismatch"
    description = "The email or password is mismatched."
    code = 400


class AuthenticationFailedError(BaseHTTPException):
    error_code = "authentication_failed"
    description = "Invalid email or password."
    code = 401


class EmailPasswordLoginLimitError(BaseHTTPException):
    error_code = "email_code_login_limit"
    description = "Too many incorrect password attempts. Please try again later."
    code = 429


class EmailCodeLoginRateLimitExceededError(BaseHTTPException):
    error_code = "email_code_login_rate_limit_exceeded"
    description = "Too many login emails have been sent. Please try again in {minutes} minutes."
    code = 429

    def __init__(self, minutes: int = 5):
        description = self.description.format(minutes=int(minutes)) if self.description else None
        super().__init__(description=description)


class EmailCodeAccountDeletionRateLimitExceededError(BaseHTTPException):
    error_code = "email_code_account_deletion_rate_limit_exceeded"
    description = "Too many account deletion emails have been sent. Please try again in {minutes} minutes."
    code = 429

    def __init__(self, minutes: int = 5):
        description = self.description.format(minutes=int(minutes)) if self.description else None
        super().__init__(description=description)


class EmailPasswordResetLimitError(BaseHTTPException):
    error_code = "email_password_reset_limit"
    description = "Too many failed password reset attempts. Please try again in 24 hours."
    code = 429


class EmailRegisterLimitError(BaseHTTPException):
    error_code = "email_register_limit"
    description = "Too many failed email register attempts. Please try again in 24 hours."
    code = 429


class EmailChangeLimitError(BaseHTTPException):
    error_code = "email_change_limit"
    description = "Too many failed email change attempts. Please try again in 24 hours."
    code = 429


class EmailAlreadyInUseError(BaseHTTPException):
    error_code = "email_already_in_use"
    description = "A user with this email already exists."
    code = 400


class OwnerTransferLimitError(BaseHTTPException):
    error_code = "owner_transfer_limit"
    description = "Too many failed owner transfer attempts. Please try again in 24 hours."
    code = 429


class NotOwnerError(BaseHTTPException):
    error_code = "not_owner"
    description = "You are not the owner of the workspace."
    code = 400


class CannotTransferOwnerToSelfError(BaseHTTPException):
    error_code = "cannot_transfer_owner_to_self"
    description = "You cannot transfer ownership to yourself."
    code = 400


class MemberNotInTenantError(BaseHTTPException):
    error_code = "member_not_in_tenant"
    description = "The member is not in the workspace."
    code = 400
