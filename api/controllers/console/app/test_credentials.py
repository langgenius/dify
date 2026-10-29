"""Console error mapping for Builder test credential execution."""

from collections.abc import Callable
from functools import wraps

from libs.exception import BaseHTTPException
from libs.external_api import document_errors
from services.workflow_test_credentials import TestCredentialNotReadyError, TestCredentialReadiness


class TestCredentialsNotReadyError(BaseHTTPException):
    code = 400
    error_code = "test_credentials_not_ready"
    description = "Required test credentials are not ready."
    details_model = TestCredentialReadiness


def test_credential_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except TestCredentialNotReadyError as exc:
            error = TestCredentialsNotReadyError()
            assert error.data is not None
            error.data["details"] = exc.result.model_dump(mode="json")
            raise error from exc

    return document_errors(wrapped, TestCredentialsNotReadyError)
