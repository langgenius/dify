import pytest

from controllers.console.billing.error import to_billing_request_error
from services.errors.billing import BillingError


def test_to_billing_request_error_rejects_unknown_error() -> None:
    with pytest.raises(TypeError, match="Unsupported billing error"):
        to_billing_request_error(BillingError())
