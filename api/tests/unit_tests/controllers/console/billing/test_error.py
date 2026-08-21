from unittest.mock import patch

import pytest
from pydantic import BaseModel
from pydantic_core import PydanticSerializationError

from controllers.console.billing.error import (
    BillingOperationFailedError,
    dump_billing_response,
    to_billing_request_error,
)
from services.errors.billing import BillingError


class _BillingURLResponse(BaseModel):
    url: str


def test_to_billing_request_error_rejects_unknown_error() -> None:
    with pytest.raises(TypeError, match="Unsupported billing error"):
        to_billing_request_error(BillingError())


def test_dump_billing_response_maps_invalid_payload() -> None:
    with pytest.raises(BillingOperationFailedError):
        dump_billing_response(_BillingURLResponse, {})


def test_dump_billing_response_maps_serialization_failure() -> None:
    with patch(
        "controllers.console.billing.error.dump_response",
        side_effect=PydanticSerializationError("serialization failed"),
    ):
        with pytest.raises(BillingOperationFailedError):
            dump_billing_response(_BillingURLResponse, {"url": "https://example.com"})


def test_dump_billing_response_does_not_expose_unknown_value_error_as_bad_request() -> None:
    original_error = ValueError("programming error")
    with patch("controllers.console.billing.error.dump_response", side_effect=original_error):
        with pytest.raises(RuntimeError, match="Unexpected billing response value error") as exc_info:
            dump_billing_response(_BillingURLResponse, {"url": "https://example.com"})

    assert exc_info.value.__cause__ is original_error
