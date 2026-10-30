"""HTTP failures shared by personal Connection management and the OAuth callback."""

from typing import Any, NoReturn

from pydantic import BaseModel, ConfigDict, Field, JsonValue
from pydantic.json_schema import SkipJsonSchema
from werkzeug.exceptions import Unauthorized

from libs.exception import BaseHTTPException
from services.end_user_connections.contracts import UpdateConnectionInput
from services.end_user_connections.errors import (
    ConnectionAccountRequiredError,
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionError,
    ConnectionIdentityError,
    ConnectionInvalidCredentialsError,
    ConnectionNotFoundError,
    ConnectionOAuthError,
    ConnectionReauthorizationRequiredError,
    ConnectionRequiredError,
    ConnectionRevisionChangedError,
    ConnectionSecretUnavailableError,
)
from services.end_user_connections.revision import ConnectionRevision


def _omit_schema_default(schema: dict[str, Any]) -> None:
    schema.pop("default", None)


class ConnectionUpdatePayload(UpdateConnectionInput):
    model_config = ConfigDict(
        json_schema_extra={"minProperties": 1, "dependentRequired": {"credentials": ["connection_revision"]}}
    )

    connection_revision: ConnectionRevision | SkipJsonSchema[None] = Field(
        default=None,
        json_schema_extra=_omit_schema_default,
        description="Provider revision required when replacing credentials.",
    )
    name: str | SkipJsonSchema[None] = Field(
        default=None,
        min_length=1,
        max_length=100,
        json_schema_extra=_omit_schema_default,
    )
    credentials: dict[str, JsonValue] | SkipJsonSchema[None] = Field(
        default=None,
        min_length=1,
        repr=False,
        json_schema_extra=_omit_schema_default,
    )


class ConnectionLoginRequiredError(BaseHTTPException):
    code = 401
    error_code = "end_user_login_required"
    description = "Sign in to use personal connections."


class ConnectionNotFoundHTTPError(BaseHTTPException):
    code = 404
    error_code = "connection_not_found"
    description = "Connection not found."


class ConnectionRequiredHTTPError(BaseHTTPException):
    code = 400
    error_code = "connection_required"
    description = "Select a connection for every required tool before running."


class ConnectionConfigurationHTTPError(BaseHTTPException):
    code = 400
    error_code = "connection_configuration_invalid"
    description = "The connection is not compatible with this tool configuration."


class ConnectionConflictHTTPError(BaseHTTPException):
    code = 409
    error_code = "connection_conflict"
    description = "Connection changed during the operation."


class ConnectionRevisionChangeDetails(BaseModel):
    connection_revision: ConnectionRevision | None


class ConnectionRevisionChangedHTTPError(BaseHTTPException):
    code = 409
    error_code = "connection_revision_changed"
    details_model = ConnectionRevisionChangeDetails
    description = "The connection requirements changed. Refresh and confirm again."


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
    if isinstance(error, ConnectionRevisionChangedError):
        exception = ConnectionRevisionChangedHTTPError()
        details = ConnectionRevisionChangeDetails(connection_revision=error.current_revision)
        assert exception.data is not None
        exception.data["details"] = details.model_dump(mode="json")
        raise exception from None
    errors: dict[type[ConnectionError], type[BaseHTTPException]] = {
        ConnectionAccountRequiredError: ConnectionLoginRequiredError,
        ConnectionOAuthError: ConnectionOAuthHTTPError,
        ConnectionReauthorizationRequiredError: ConnectionReauthorizationHTTPError,
        ConnectionNotFoundError: ConnectionNotFoundHTTPError,
        ConnectionConfigurationError: ConnectionConfigurationHTTPError,
        ConnectionRequiredError: ConnectionRequiredHTTPError,
        ConnectionConflictError: ConnectionConflictHTTPError,
        ConnectionInvalidCredentialsError: ConnectionCredentialsHTTPError,
        ConnectionCheckUnavailableError: ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableError: ConnectionSecretUnavailableHTTPError,
    }
    if exception := errors.get(type(error)):
        raise exception() from None
    raise error
