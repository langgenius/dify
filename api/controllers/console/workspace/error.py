from libs.exception import BaseHTTPException


class RepeatPasswordNotMatchError(BaseHTTPException):
    error_code = 'repeat_password_not_match'
    description = "New password and repeat password does not match."
    code = 400


class ProviderRequestFailedError(BaseHTTPException):
    error_code = 'provider_request_failed'
    description = None
    code = 400


class InvalidInvitationCodeError(BaseHTTPException):
    error_code = 'invalid_invitation_code'
    description = "Invalid invitation code."
    code = 400


class AccountAlreadyInitedError(BaseHTTPException):
    error_code = 'account_already_inited'
    description = "Account already inited."
    code = 400


class AccountNotInitializedError(BaseHTTPException):
    error_code = 'account_not_initialized'
    description = "Account not initialized."
    code = 400
