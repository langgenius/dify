from http import HTTPStatus

from pydantic import Field

from fields.base import ResponseModel
from libs.exception import BaseHTTPException


class ChannelProviderFailureDetails(ResponseModel):
    provider_error_code: str | None = Field(default=None, exclude_if=lambda value: value is None)
    provider_request_id: str | None = Field(default=None, exclude_if=lambda value: value is None)
    http_status: int | None = Field(default=None, exclude_if=lambda value: value is None)
    missing_permissions: tuple[str, ...] = Field(default=(), exclude_if=lambda value: not value)


class ChannelAlreadyConfiguredHttpError(BaseHTTPException):
    error_code = "conflict"
    description = "A Channel is already configured for this kind."
    code = HTTPStatus.CONFLICT


class ChannelNotFoundHttpError(BaseHTTPException):
    error_code = "not_found"
    description = "Channel not found."
    code = HTTPStatus.NOT_FOUND


class ChannelProviderConfigurationUpdatedHttpError(BaseHTTPException):
    error_code = "provider_configuration_updated"
    description = "The Channel configuration was updated."
    code = HTTPStatus.CONFLICT


class ChannelProviderBadRequestHttpError(BaseHTTPException):
    error_code = "bad_request"
    code = HTTPStatus.BAD_REQUEST

    def __init__(self, description: str, *, details: ChannelProviderFailureDetails | None = None) -> None:
        """Translate a safe provider rejection at the HTTP boundary without losing diagnostics."""
        super().__init__(description)
        if details is not None:
            assert self.data is not None
            self.data["details"] = details.model_dump(mode="json")


class ChannelReplacementRequiredHttpError(BaseHTTPException):
    error_code = "replacement_required"
    description = "Explicit IM Channel replacement is required."
    code = HTTPStatus.CONFLICT
