"""Pure Console session token policy tests."""

from datetime import UTC, datetime, timedelta

import pytest

from services.account.console_session import (
    CONSOLE_TOKEN_AUDIENCE,
    access_token_account_id,
    access_token_claims,
    build_refresh_token,
    csrf_token_claims,
    parse_refresh_token,
    valid_refresh_csrf_claims,
)

ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"
SESSION_ID = "a" * 32
SECRET = "b" * 64


def test_access_claims_bind_identity_session_issuer_audience_and_lifetime() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    claims = access_token_claims(ACCOUNT_ID, SESSION_ID, issuer="CLOUD", now=now, lifetime=timedelta(minutes=15))

    assert claims == {
        "user_id": ACCOUNT_ID,
        "sub": ACCOUNT_ID,
        "sid": SESSION_ID,
        "iss": "CLOUD",
        "aud": CONSOLE_TOKEN_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int(now.timestamp()) + 900,
        "token_type": "console_access",
    }
    assert access_token_account_id(claims) == ACCOUNT_ID


def test_refresh_token_round_trip() -> None:
    token = build_refresh_token(ACCOUNT_ID, SESSION_ID, SECRET)

    assert token == f"v2.{ACCOUNT_ID}.{SESSION_ID}.{SECRET}"
    assert parse_refresh_token(token) == (ACCOUNT_ID, SESSION_ID)


def test_csrf_claims_bind_nonce_account_and_expiry() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    claims = csrf_token_claims(ACCOUNT_ID, "c" * 32, now=now, lifetime=timedelta(minutes=15))

    assert claims == {"sub": ACCOUNT_ID, "exp": int(now.timestamp()) + 900, "jti": "c" * 32}


@pytest.mark.parametrize(
    ("account_id", "session_id", "secret"),
    [
        ("account-id", SESSION_ID, SECRET),
        (ACCOUNT_ID.replace("-", ""), SESSION_ID, SECRET),
        (ACCOUNT_ID, SESSION_ID.upper(), SECRET),
        (ACCOUNT_ID, SESSION_ID[:-1], SECRET),
        (ACCOUNT_ID, SESSION_ID, SECRET.upper()),
        (ACCOUNT_ID, SESSION_ID, SECRET[:-1]),
        (ACCOUNT_ID, SESSION_ID, SECRET + ".extra"),
    ],
)
def test_refresh_token_rejects_invalid_identity_or_secret(account_id: str, session_id: str, secret: str) -> None:
    assert parse_refresh_token(f"v2.{account_id}.{session_id}.{secret}") is None
    with pytest.raises(ValueError, match="refresh token"):
        build_refresh_token(account_id, session_id, secret)


@pytest.mark.parametrize("token", ["legacy", "", f"v1.{ACCOUNT_ID}.{SESSION_ID}.{SECRET}"])
def test_refresh_token_rejects_old_and_missing_formats(token: str) -> None:
    assert parse_refresh_token(token) is None


@pytest.mark.parametrize("refresh_token", [None, f"v2.{ACCOUNT_ID}.{SESSION_ID}.{SECRET}"])
def test_refresh_csrf_proof_allows_expired_claims_for_the_same_account(refresh_token: str | None) -> None:
    assert valid_refresh_csrf_claims({"sub": ACCOUNT_ID, "exp": 1, "jti": "c" * 32}, refresh_token)


@pytest.mark.parametrize(
    ("claim", "value"),
    [
        ("sub", 123),
        ("sub", "not-a-uuid"),
        ("sub", ACCOUNT_ID.replace("-", "")),
        ("exp", True),
        ("exp", "1"),
        ("jti", 123),
        ("jti", "c" * 31),
        ("jti", "C" * 32),
        ("aud", None),
        ("token_type", None),
        ("token_source", None),
    ],
)
def test_refresh_csrf_proof_rejects_invalid_claims(claim: str, value: object) -> None:
    claims: dict[str, object] = {"sub": ACCOUNT_ID, "exp": 1, "jti": "c" * 32}
    claims[claim] = value

    assert not valid_refresh_csrf_claims(claims, None)


@pytest.mark.parametrize("claim", ["sub", "exp", "jti"])
def test_refresh_csrf_proof_requires_all_claims(claim: str) -> None:
    claims: dict[str, object] = {"sub": ACCOUNT_ID, "exp": 1, "jti": "c" * 32}
    del claims[claim]

    assert not valid_refresh_csrf_claims(claims, None)


@pytest.mark.parametrize(
    "refresh_token",
    ["", "legacy", f"v2.22222222-2222-4222-8222-222222222222.{SESSION_ID}.{SECRET}"],
)
def test_refresh_csrf_proof_rejects_malformed_or_other_account_refresh_tokens(refresh_token: str) -> None:
    assert not valid_refresh_csrf_claims({"sub": ACCOUNT_ID, "exp": 1, "jti": "c" * 32}, refresh_token)
