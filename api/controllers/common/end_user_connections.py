"""HTTP failures shared by personal Connection management and the OAuth callback."""

from typing import NoReturn

from werkzeug.exceptions import Unauthorized

from libs.exception import BaseHTTPException
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionError,
    ConnectionIdentityError,
    ConnectionInvalidCredentialsError,
    ConnectionNotFoundError,
    ConnectionOAuthError,
    ConnectionReauthorizationRequiredError,
    ConnectionSecretUnavailableError,
    ConnectionWorkflowChangedError,
)


class ConnectionLoginRequiredError(BaseHTTPException):
    code = 401
    error_code = "end_user_login_required"
    description = "Sign in to manage personal connections."


class ConnectionNotFoundHTTPError(BaseHTTPException):
    code = 404
    error_code = "connection_not_found"
    description = "Connection not found."


class ConnectionConfigurationHTTPError(BaseHTTPException):
    code = 400
    error_code = "connection_configuration_invalid"
    description = "The connection is not compatible with this tool configuration."


class ConnectionConflictHTTPError(BaseHTTPException):
    code = 409
    error_code = "connection_conflict"
    description = "Connection changed during the operation."


class ConnectionWorkflowChangedHTTPError(BaseHTTPException):
    code = 409
    error_code = "workflow_changed"
    description = "The workflow changed. Confirm the connection selection again."


class ConnectionCredentialsHTTPError(BaseHTTPException):
    code = 400
    error_code = "connection_credentials_invalid"
    description = "Invalid credentials for this provider."


class ConnectionCheckUnavailableHTTPError(BaseHTTPException):
    code = 503
    error_code = "credential_check_unavailable"
    description = "Credential validation is temporarily unavailable."


class ConnectionSecretUnavailableHTTPError(BaseHTTPException):
    code = 503
    error_code = "connection_credentials_unavailable"
    description = "Connection credentials are temporarily unavailable."


class ConnectionOAuthHTTPError(BaseHTTPException):
    code = 400
    error_code = "connection_oauth_failed"
    description = "OAuth authorization could not be completed. Start authorization again."


class ConnectionReauthorizationHTTPError(BaseHTTPException):
    code = 409
    error_code = "connection_reauthorization_required"
    description = "The OAuth client changed or is unavailable. Start authorization again."


def raise_connection_error(error: ConnectionError) -> NoReturn:
    if isinstance(error, ConnectionIdentityError):
        raise Unauthorized(str(error)) from None
    errors: dict[type[ConnectionError], type[BaseHTTPException]] = {
        ConnectionOAuthError: ConnectionOAuthHTTPError,
        ConnectionReauthorizationRequiredError: ConnectionReauthorizationHTTPError,
        ConnectionNotFoundError: ConnectionNotFoundHTTPError,
        ConnectionConfigurationError: ConnectionConfigurationHTTPError,
        ConnectionConflictError: ConnectionConflictHTTPError,
        ConnectionWorkflowChangedError: ConnectionWorkflowChangedHTTPError,
        ConnectionInvalidCredentialsError: ConnectionCredentialsHTTPError,
        ConnectionCheckUnavailableError: ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableError: ConnectionSecretUnavailableHTTPError,
    }
    if exception := errors.get(type(error)):
        raise exception() from None
    raise error
