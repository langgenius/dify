from collections.abc import Callable
from datetime import UTC, datetime

import jwt
import pytest

from configs import dify_config
from libs.passport import PassportService
from services.account.console_tokens import (
    CONSOLE_TOKEN_AUDIENCE,
    issue_console_access_token,
    issue_console_csrf_token,
    verify_console_access_token,
    verify_refresh_csrf_proof,
)
from services.account_errors import InvalidConsoleAccessTokenError

ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"
SESSION_ID = "a" * 32
SECRET = "console-session-test-signing-key-" * 3


@pytest.fixture(autouse=True)
def configure_tokens(config_overrides: Callable[..., None]) -> None:
    config_overrides(SECRET_KEY=SECRET, ACCESS_TOKEN_EXPIRE_MINUTES=15)


def test_access_token_binds_the_account_session_audience_and_lifetime() -> None:
    token = issue_console_access_token(ACCOUNT_ID, SESSION_ID)
    assert verify_console_access_token(token) == ACCOUNT_ID
    claims = jwt.decode(token, SECRET, algorithms=["HS256"], audience=CONSOLE_TOKEN_AUDIENCE)
    assert claims["sub"] == claims["user_id"] == ACCOUNT_ID
    assert claims["sid"] == SESSION_ID
    assert claims["iss"] == dify_config.DEPLOYMENT_EDITION.value
    assert claims["exp"] - claims["iat"] == 15 * 60


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("iss", "untrusted"),
        ("aud", "webapp"),
        ("token_type", "refresh"),
        ("token_source", "webapp_login_token"),
        ("user_id", "another-account"),
        ("sid", ""),
        ("sid", 123),
        ("sub", ""),
        ("sub", 123),
        ("exp", 1),
        ("iat", 9999999999),
    ],
)
def test_console_rejects_signed_tokens_with_invalid_claims(name: str, value: str | int) -> None:
    claims = jwt.decode(
        issue_console_access_token(ACCOUNT_ID, SESSION_ID),
        SECRET,
        algorithms=["HS256"],
        audience=CONSOLE_TOKEN_AUDIENCE,
    )
    claims[name] = value
    with pytest.raises(InvalidConsoleAccessTokenError):
        verify_console_access_token(PassportService().issue(claims))


@pytest.mark.parametrize("claim", ["sub", "sid", "iss", "aud", "iat", "exp", "token_type", "user_id"])
def test_console_requires_all_access_claims(claim: str) -> None:
    claims = jwt.decode(
        issue_console_access_token(ACCOUNT_ID, SESSION_ID),
        SECRET,
        algorithms=["HS256"],
        audience=CONSOLE_TOKEN_AUDIENCE,
    )
    del claims[claim]
    with pytest.raises(InvalidConsoleAccessTokenError):
        verify_console_access_token(PassportService().issue(claims))


def test_csrf_legacy_and_other_passports_cannot_authenticate_a_console_session() -> None:
    now = int(datetime.now(UTC).timestamp())
    legacy = PassportService().issue({"user_id": ACCOUNT_ID, "exp": now + 60, "sub": "Console API Passport"})
    webapp = PassportService().issue({"user_id": ACCOUNT_ID, "exp": now + 60, "token_source": "webapp_login_token"})
    for token in (issue_console_csrf_token(ACCOUNT_ID), legacy, webapp, "not-a-token"):
        with pytest.raises(InvalidConsoleAccessTokenError):
            verify_console_access_token(token)


def test_console_rejects_other_keys_and_algorithms() -> None:
    claims = jwt.decode(
        issue_console_access_token(ACCOUNT_ID, SESSION_ID),
        SECRET,
        algorithms=["HS256"],
        audience=CONSOLE_TOKEN_AUDIENCE,
    )
    for key, algorithm in [("different-secret-key-at-least-32-bytes", "HS256"), (SECRET, "HS512")]:
        with pytest.raises(InvalidConsoleAccessTokenError):
            verify_console_access_token(jwt.encode(claims, key, algorithm=algorithm))


def test_refresh_csrf_proof_verifies_an_expired_token_without_admitting_it_as_access() -> None:
    token = jwt.encode({"sub": ACCOUNT_ID, "exp": 1, "jti": "c" * 32}, SECRET, algorithm="HS256")
    refresh_token = f"v2.{ACCOUNT_ID}.{SESSION_ID}.{'b' * 64}"

    assert verify_refresh_csrf_proof(token, token, refresh_token)
    assert verify_refresh_csrf_proof(token, token, None)
    with pytest.raises(InvalidConsoleAccessTokenError):
        verify_console_access_token(token)


def test_each_csrf_token_has_a_distinct_signed_generation() -> None:
    first = jwt.decode(issue_console_csrf_token(ACCOUNT_ID), SECRET, algorithms=["HS256"])
    second = jwt.decode(issue_console_csrf_token(ACCOUNT_ID), SECRET, algorithms=["HS256"])

    assert first["sub"] == second["sub"] == ACCOUNT_ID
    assert len(first["jti"]) == len(second["jti"]) == 32
    assert first["jti"] != second["jti"]


@pytest.mark.parametrize(
    ("csrf_header", "csrf_cookie"),
    [(None, None), (None, "token"), ("token", None), ("one", "two"), ("invalid", "invalid"), ("☃", "☃")],
)
def test_refresh_csrf_proof_requires_matching_signed_header_and_cookie(
    csrf_header: str | None, csrf_cookie: str | None
) -> None:
    assert not verify_refresh_csrf_proof(csrf_header, csrf_cookie, None)


@pytest.mark.parametrize(
    ("key", "algorithm"),
    [("different-secret-key-at-least-32-bytes", "HS256"), (SECRET, "HS512")],
)
def test_refresh_csrf_proof_rejects_other_keys_and_algorithms(key: str, algorithm: str) -> None:
    token = jwt.encode({"sub": ACCOUNT_ID, "exp": 1, "jti": "c" * 32}, key, algorithm=algorithm)

    assert not verify_refresh_csrf_proof(token, token, None)


def test_refresh_csrf_proof_rejects_access_tokens() -> None:
    token = issue_console_access_token(ACCOUNT_ID, SESSION_ID)

    assert not verify_refresh_csrf_proof(token, token, None)
