import pytest
from werkzeug.exceptions import Forbidden

from controllers.console.resource_access_token import _require_owner
from models.account import Account, TenantAccountRole


def test_require_owner_allows_owner() -> None:
    account = Account(name="Owner", email="owner@example.com")
    account.role = TenantAccountRole.OWNER
    _require_owner(account)


def test_require_owner_rejects_non_owner() -> None:
    account = Account(name="Admin", email="admin@example.com")
    account.role = TenantAccountRole.ADMIN
    with pytest.raises(Forbidden):
        _require_owner(account)


@pytest.mark.parametrize(
    ("error", "status"),
    [
        ("input", 400),
        ("forbidden", 403),
        ("missing", 404),
        ("invalid", 401),
    ],
)
def test_service_failures_keep_the_http_error_contract(error: str, status: int) -> None:
    from werkzeug.exceptions import HTTPException

    from controllers.common.resource_access_token_errors import resource_access_token_errors
    from services.auth.resource_access_token_contracts import (
        ResourceAccessTokenForbiddenError,
        ResourceAccessTokenInputError,
        ResourceAccessTokenInvalidError,
        ResourceAccessTokenNotFoundError,
    )

    errors = {
        "input": ResourceAccessTokenInputError,
        "forbidden": ResourceAccessTokenForbiddenError,
        "missing": ResourceAccessTokenNotFoundError,
        "invalid": ResourceAccessTokenInvalidError,
    }
    with pytest.raises(HTTPException) as raised:
        with resource_access_token_errors():
            raise errors[error]("original message")
    assert raised.value.code == status
    assert raised.value.description == "original message"
