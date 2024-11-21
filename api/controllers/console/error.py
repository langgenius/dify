from libs.exception import BaseHTTPException


class AlreadySetupError(BaseHTTPException):
    error_code = "already_setup"
    description = "Dify has been successfully installed. Please refresh the page or return to the dashboard homepage."
    code = 403


class NotSetupError(BaseHTTPException):
    error_code = "not_setup"
    description = (
        "Dify has not been initialized and installed yet. "
        "Please proceed with the initialization and installation process first."
    )
    code = 401


class NotInitValidateError(BaseHTTPException):
    error_code = "not_init_validated"
    description = "Init validation has not been completed yet. Please proceed with the init validation process first."
    code = 401


class InitValidateFailedError(BaseHTTPException):
    error_code = "init_validate_failed"
    description = "Init validation failed. Please check the password and try again."
    code = 401


class AccountNotLinkTenantError(BaseHTTPException):
    error_code = "account_not_link_tenant"
    description = "Account not link tenant."
    code = 403


class AlreadyActivateError(BaseHTTPException):
    error_code = "already_activate"
    description = "Auth Token is invalid or account already activated, please check again."
    code = 403


class NotAllowedCreateWorkspace(BaseHTTPException):
    error_code = "not_allowed_create_workspace"
    description = "Workspace not found, please contact system admin to invite you to join in a workspace."
    code = 400


class AccountBannedError(BaseHTTPException):
    error_code = "account_banned"
    description = "Account is banned."
    code = 400


class AccountNotFound(BaseHTTPException):
    error_code = "account_not_found"
    description = "Account not found."
    code = 400


class EmailSendIpLimitError(BaseHTTPException):
    error_code = "email_send_ip_limit"
    description = "Too many emails have been sent from this IP address recently. Please try again later."
    code = 429


class FileTooLargeError(BaseHTTPException):
    error_code = "file_too_large"
    description = "File size exceeded. {message}"
    code = 413


class UnsupportedFileTypeError(BaseHTTPException):
    error_code = "unsupported_file_type"
    description = "File type not allowed."
    code = 415


class TooManyFilesError(BaseHTTPException):
    error_code = "too_many_files"
    description = "Only one file is allowed."
    code = 400


class NoFileUploadedError(BaseHTTPException):
    error_code = "no_file_uploaded"
    description = "Please upload your file."
    code = 400


class UnauthorizedAndForceLogout(BaseHTTPException):
    error_code = "unauthorized_and_force_logout"
    description = "Unauthorized and force logout."
    code = 401
