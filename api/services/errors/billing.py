from dataclasses import dataclass
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, ValidationError, ValidatorFunctionWrapHandler, WrapValidator


class BillingError(Exception):
    pass


class ComplianceRateLimitExceededError(BillingError):
    pass


def _none_on_error(value: object, handler: ValidatorFunctionWrapHandler) -> Any:
    try:
        return handler(value)
    except ValidationError:
        return None


type _Lenient[T] = Annotated[T | None, WrapValidator(_none_on_error)]


class UpstreamErrorBody(BaseModel):
    """Kratos error body of a non-200 reply, without its reason.

    A field of an unexpected type reads as None instead of failing the rest.
    """

    model_config = ConfigDict(extra="ignore", frozen=True)

    code: _Lenient[int] = None
    message: _Lenient[str] = None
    metadata: _Lenient[dict[str, str]] = None


@dataclass(frozen=True)
class UnknownErrorReason:
    """A reason missing from the snapshot the billing client was generated from."""

    value: str


class BillingUpstreamError(BillingError):
    """A billing or saas call failed.

    `status_code` and `body` are set when the upstream answered with a non-200 status. Each
    generated service module subclasses this with a `reason` typed by its own `ErrorReason`;
    catch that subclass to read the reason.
    """

    def __init__(self, *args: object, status_code: int | None = None, body: UpstreamErrorBody | None = None) -> None:
        super().__init__(*args)
        self.status_code = status_code
        self.body = body


class BillingUpstreamInvalidResponseError(BillingUpstreamError):
    pass


class BillingUpstreamUnavailableError(BillingUpstreamError):
    pass
