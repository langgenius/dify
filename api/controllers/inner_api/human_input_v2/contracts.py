"""Shared transport declarations for the deployment Human Input API.

Authentication uses the existing enterprise_inner_api_only decorator. The
deployment determines scope; requests cannot choose an organization, workspace,
or Dify Account. These models do not authenticate callers or perform I/O.
"""

from pydantic import BaseModel, ConfigDict, ValidationError

from controllers.common.schema import register_response_schema_models
from controllers.inner_api import inner_api_ns
from libs.exception import RelayedHTTPError
from libs.external_api import ErrorResponse


class RequestModel(BaseModel):
    """Reject unknown request fields without exposing inputs in validation errors."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class APIErrorResponse(ErrorResponse):
    """Reuse the existing Inner API error schema for all non-success responses."""


register_response_schema_models(inner_api_ns, APIErrorResponse)


def parse_request[Model: BaseModel](model: type[Model], values: object) -> Model:
    """Parse external input once; return its DTO or a sanitized input error at this boundary."""
    try:
        return model.model_validate(values)
    except ValidationError:
        raise RelayedHTTPError(status=400, error_code="invalid_param", message="Invalid request parameters") from None
