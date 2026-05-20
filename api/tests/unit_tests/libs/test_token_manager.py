"""
Regression tests for the `_TokenData` TypedDict used by
`libs.helper.TokenManager`.

These tests guard the contract that every field a caller writes via
`generate_token` survives the TypedDict-validated round-trip performed
by `get_token_data`. Specifically, the `phase` / `email_change_phase`
fields that the console and web `forgot-password` + `change-email`
controllers depend on for the security check introduced in PR #35425
(GHSA-4q3w-q5mc-45rq) must be preserved — otherwise downstream phase
checks always fail with `InvalidTokenError`.
"""

import json

# pyright: reportPrivateUsage=false
from libs.helper import _token_data_adapter


def test_token_data_adapter_preserves_phase_field() -> None:
    """`phase` written by callers like generate_reset_password_token must
    survive the TypedDict-validated round-trip in get_token_data.

    Regression: PR #34380 introduced `_TokenData` but did not list
    `phase`, so the TypeAdapter silently dropped it and the security
    gate from PR #35425 (GHSA-4q3w-q5mc-45rq) always failed.
    """
    payload = {
        "account_id": None,
        "email": "user@example.com",
        "token_type": "reset_password",
        "code": "123456",
        "phase": "reset",
    }
    data = dict(_token_data_adapter.validate_json(json.dumps(payload)))

    assert data.get("phase") == "reset", (
        "phase field was stripped by the _TokenData TypedDict adapter; "
        "the forgot-password phase-bound check (PR #35425) will always fail."
    )


def test_token_data_adapter_preserves_change_email_payload() -> None:
    """Sanity round-trip for the change-email flow: every field set by
    `generate_change_email_token` must come back, including the phase
    string the controller branches on."""
    payload = {
        "account_id": "acc-1",
        "email": "new@example.com",
        "token_type": "change_email",
        "code": "654321",
        "old_email": "old@example.com",
        "phase": "verify_old_email",
    }
    data = dict(_token_data_adapter.validate_json(json.dumps(payload)))

    assert data.get("old_email") == "old@example.com"
    assert data.get("phase") == "verify_old_email"


def test_token_data_adapter_preserves_change_email_phase_key() -> None:
    """`email_change_phase` must survive because the change-email controllers
    branch on `AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY`, not `phase`.

    Regression: PR #36116 fixed the generic `phase` field but missed the
    dedicated change-email key introduced by PR #35425, so the Redis ->
    TypedDict round-trip silently stripped the phase and every
    `/account/change-email/validity` call failed with `InvalidTokenError`.
    """
    payload = {
        "account_id": "acc-1",
        "email": "new@example.com",
        "token_type": "change_email",
        "code": "654321",
        "old_email": "old@example.com",
        "email_change_phase": "old_email",
    }
    data = dict(_token_data_adapter.validate_json(json.dumps(payload)))

    assert data.get("email_change_phase") == "old_email", (
        "email_change_phase field was stripped by the _TokenData TypedDict adapter; "
        "the change-email validity step will always reject the token."
    )
