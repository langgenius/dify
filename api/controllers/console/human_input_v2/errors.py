from http import HTTPStatus

from pydantic import Field

from fields.base import ResponseModel
from libs.exception import BaseHTTPException


class ChannelProviderBadRequestResponse(ResponseModel):
    """HTTP failure with only provider-supplied diagnostic identifiers."""

    code: str
    message: str
    status: int
    provider_error_code: str | None = Field(default=None, description="Original provider error code, if supplied.")
    provider_request_id: str | None = Field(default=None, description="Original provider request ID, if supplied.")


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

    def __init__(
        self,
        description: str,
        *,
        provider_error_code: str | None = None,
        provider_request_id: str | None = None,
    ) -> None:
        """Preserve supplied diagnostics; serialize absent values as null without generating IDs."""
        super().__init__(description)
        self.data = ChannelProviderBadRequestResponse(
            code=self.error_code,
            message=description,
            status=HTTPStatus.BAD_REQUEST,
            provider_error_code=provider_error_code,
            provider_request_id=provider_request_id,
        ).model_dump(mode="json")


class ChannelReplacementRequiredHttpError(BaseHTTPException):
    error_code = "replacement_required"
    description = "Explicit IM Channel replacement is required."
    code = HTTPStatus.CONFLICT
