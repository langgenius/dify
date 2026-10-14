from pydantic import ConfigDict

from fields.base import ResponseModel


class InnerApiErrorResponse(ResponseModel):
    """Error body shared by inner API routes; central and legacy errors differ in optional fields."""

    model_config = ResponseModel.model_config | ConfigDict(extra="allow")

    message: str
    code: str | None = None
    status: int | None = None
