from libs.exception import BaseHTTPException


class AlreadySetupError(BaseHTTPException):
    error_code = 'already_setup'
    description = "Application already setup."
    code = 403


class NotSetupError(BaseHTTPException):
    error_code = 'not_setup'
    description = "Application not setup."
    code = 401


class AccountNotLinkTenantError(BaseHTTPException):
    error_code = 'account_not_link_tenant'
    description = "Account not link tenant."
    code = 403
