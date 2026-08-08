import time
from unittest.mock import MagicMock, patch

import pytest

from services.webapp_auth_service import WebAppAuthService


class _DummyPassportService:
    def __init__(self):
        self.payload = None

    def issue(self, payload):
        self.payload = payload
        return "mock_token"


def _make_account():
    account = MagicMock()
    account.id = "acct-1"
    account.email = "user@example.com"
    return account


@pytest.mark.parametrize("configured_minutes", [60, 30, 120, 1])
def test_webapp_login_token_exp_matches_access_token_expire_minutes(configured_minutes):
    """The web-app login JWT expiry must equal ACCESS_TOKEN_EXPIRE_MINUTES.

    Regression guard for a ``* 24`` multiplier that previously stretched the
    web-app login token lifetime to 24x the configured value (a 60-minute
    setting silently became a 24-hour token).
    """
    account = _make_account()
    dummy = _DummyPassportService()

    before = time.time()
    with (
        patch("services.webapp_auth_service.dify_config") as mock_cfg,
        patch("services.webapp_auth_service.PassportService", return_value=dummy),
    ):
        mock_cfg.ACCESS_TOKEN_EXPIRE_MINUTES = configured_minutes
        WebAppAuthService._get_account_jwt_token(account=account)
    after = time.time()

    payload = dummy.payload
    assert payload is not None
    assert "exp" in payload

    expected_lower = before + configured_minutes * 60 - 2
    expected_upper = after + configured_minutes * 60 + 2
    assert expected_lower <= payload["exp"] <= expected_upper, (
        f"web-app token exp {payload['exp']} does not match "
        f"ACCESS_TOKEN_EXPIRE_MINUTES={configured_minutes}min; "
        f"expected ~[{expected_lower:.0f}, {expected_upper:.0f}]"
    )

    # And it must not be 24x the configured lifetime.
    buggy = after + configured_minutes * 60 * 24
    assert payload["exp"] < buggy
