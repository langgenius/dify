from http import HTTPStatus

from libs.exception import BaseHTTPException


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


class ChannelReplacementRequiredHttpError(BaseHTTPException):
    error_code = "replacement_required"
    description = "Explicit IM Channel replacement is required."
    code = HTTPStatus.CONFLICT
