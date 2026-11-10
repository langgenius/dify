"""Keep shared Account email errors compatible with existing Console imports and wire contracts."""

import pytest

from controllers import account_email_errors as shared
from controllers.console import error as console
from controllers.console.auth import error as auth
from libs.exception import BaseHTTPException


@pytest.mark.parametrize(
    ("shared_error", "legacy_error", "code", "status"),
    [
        (shared.InvalidEmailError, auth.InvalidEmailError, "invalid_email", 400),
        (shared.InvalidTokenError, auth.InvalidTokenError, "invalid_or_expired_token", 400),
        (shared.EmailCodeError, auth.EmailCodeError, "email_code_error", 400),
        (shared.EmailChangeLimitError, auth.EmailChangeLimitError, "email_change_limit", 429),
        (shared.EmailAlreadyInUseError, auth.EmailAlreadyInUseError, "email_already_in_use", 400),
        (shared.EmailSendIpLimitError, console.EmailSendIpLimitError, "email_send_ip_limit", 429),
        (shared.AccountInFreezeError, console.AccountInFreezeError, "account_in_freeze", 400),
        (shared.EmailDomainSuspendedError, console.EmailDomainSuspendedError, "email_domain_suspended", 400),
        (
            shared.EmailChangeRateLimitExceededError,
            auth.EmailChangeRateLimitExceededError,
            "email_change_rate_limit_exceeded",
            429,
        ),
    ],
)
def test_legacy_exports_keep_the_same_error_type_and_wire_contract(
    shared_error: type[BaseHTTPException], legacy_error: type[BaseHTTPException], code: str, status: int
) -> None:
    assert legacy_error is shared_error
    error = shared_error()
    assert error.code == status
    assert error.data == {"code": code, "status": status, "message": error.description}


def test_retry_interval_preserves_default_and_policy_values() -> None:
    assert shared.EmailChangeRateLimitExceededError().description == (
        "Too many email change emails have been sent. Please try again in 1 minutes."
    )
    assert shared.EmailChangeRateLimitExceededError(5).description == (
        "Too many email change emails have been sent. Please try again in 5 minutes."
    )
