from pydantic import ConfigDict

from controllers.common.schema import register_response_schema_models
from controllers.inner_api import inner_api_ns
from fields.base import ResponseModel


class InnerApiErrorResponse(ResponseModel):
    """Error body shared by inner API routes; central and legacy errors differ in optional fields."""

    model_config = ConfigDict(extra="allow")

    message: str
    code: str | None = None
    status: int | None = None


register_response_schema_models(inner_api_ns, InnerApiErrorResponse)
INNER_API_ERROR_RESPONSE = inner_api_ns.models[InnerApiErrorResponse.__name__]
