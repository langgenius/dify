import pytest

from services.web_identity_service import WebIdentityError, WebIdentityService
from tests.unit_tests.web_identity_fakes import ACCOUNT_ID, WebAccounts, web_identities


def account_claims(**overrides: object) -> dict[str, object]:
    return {"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 2_000_000_000, **overrides}


@pytest.mark.parametrize("status", ["active", "uninitialized"])
def test_consumer_login_does_not_require_a_workspace(status: str) -> None:
    service = WebIdentityService(
        accounts=WebAccounts(status=status), allow_console_login=True, allow_webapp_login=False
    )
    assert service.resolve_login(account_claims()).account_id == ACCOUNT_ID


@pytest.mark.parametrize("status", [None, "closed", "banned", "pending"])
def test_unavailable_accounts_cannot_login_or_use_account_passports(status: str | None) -> None:
    service = WebIdentityService(accounts=WebAccounts(status=status), allow_console_login=True, allow_webapp_login=True)
    with pytest.raises(WebIdentityError, match="unavailable"):
        service.resolve_login(account_claims())
    with pytest.raises(WebIdentityError, match="unavailable"):
        service.validate_passport(
            {"sub": "Web API Passport", "token_source": "webapp_account", "exp": 2_000_000_000},
            account_id=ACCOUNT_ID,
        )


@pytest.mark.parametrize(
    "overrides",
    [
        {"sub": ACCOUNT_ID},
        {"sub": "Web API Passport"},
        {"token_source": "webapp_account"},
        {"token_source": "webapp"},
        {"exp": None},
        {"user_id": None},
        {"user_id": "invalid"},
        {"token_source": "webapp_login_token", "sub": "Web API Passport", "auth_type": "unknown"},
    ],
)
def test_wrong_purpose_or_incomplete_login_claims_are_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(WebIdentityError):
        web_identities().resolve_login(account_claims(**overrides))


def test_external_sso_does_not_infer_an_account_from_its_subject() -> None:
    service = WebIdentityService(accounts=WebAccounts(status=None), allow_console_login=False, allow_webapp_login=True)
    claims = service.resolve_login(
        account_claims(
            sub="Web API Passport",
            token_source="webapp_login_token",
            auth_type="external",
        )
    )
    assert claims.account_id is None


@pytest.mark.parametrize(("console", "webapp"), [(False, False), (False, True)])
def test_console_login_requires_feature_enablement(console: bool, webapp: bool) -> None:
    service = WebIdentityService(accounts=WebAccounts(), allow_console_login=console, allow_webapp_login=webapp)
    with pytest.raises(WebIdentityError):
        service.resolve_login(account_claims())


@pytest.mark.parametrize("source", [None, "webapp", "webapp_login_token"])
def test_legacy_passports_cannot_access_account_linked_end_users(source: str | None) -> None:
    with pytest.raises(WebIdentityError):
        web_identities().validate_passport(
            {"sub": "Web API Passport", "token_source": source, "exp": 2_000_000_000}, account_id=ACCOUNT_ID
        )


def test_account_passport_cannot_be_used_as_a_guest() -> None:
    with pytest.raises(WebIdentityError):
        web_identities().validate_passport(
            {"sub": "Web API Passport", "token_source": "webapp_account", "exp": 2_000_000_000}, account_id=None
        )
