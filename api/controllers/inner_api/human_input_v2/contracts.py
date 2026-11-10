"""Shared transport declarations for the unregistered EE API design.

Authentication uses the existing enterprise_inner_api_only decorator. The
deployment determines scope; requests cannot choose an organization, workspace,
or Dify Account. These models do not authenticate callers or perform I/O.
"""

from pydantic import BaseModel, ConfigDict

from controllers.common.schema import register_response_schema_models
from controllers.inner_api import inner_api_ns
from libs.external_api import ErrorResponse


class RequestModel(BaseModel):
    """Reject unknown request fields without exposing inputs in validation errors."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class APIErrorResponse(ErrorResponse):
    """Reuse the existing Inner API error schema for all non-success responses."""


register_response_schema_models(inner_api_ns, APIErrorResponse)
