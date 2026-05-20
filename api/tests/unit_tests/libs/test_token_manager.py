"""
Regression tests for `libs.helper.TokenManager`.

`TokenManager` is the storage primitive shared by multiple auth flows, so it
must preserve every metadata field written by the caller. Business-specific
validation now happens at the callsite boundary (for example,
`AccountService.get_change_email_data`), not inside `TokenManager`.
"""

import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

import libs.helper as helper_module
from libs.helper import TokenManager


def _build_fake_redis(storage: dict[str, str]):
    def store_value(key: str, _ttl: int, value: str) -> bool:
        storage[key] = value
        return True

    def load_value(key: str) -> str | None:
        return storage.get(key)

    return SimpleNamespace(
        setex=store_value,
        get=load_value,
        delete=lambda *_args, **_kwargs: None,
    )


def test_token_manager_roundtrip_preserves_untyped_metadata_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """`TokenManager` must round-trip arbitrary metadata keys without silently
    dropping fields such as `phase`, `email_change_phase`, or future auth
    payload extensions.
    """

    storage: dict[str, str] = {}
    monkeypatch.setattr(helper_module, "redis_client", _build_fake_redis(storage))

    token = TokenManager.generate_token(
        email="user@example.com",
        token_type="change_email",
        additional_data={
            "code": "654321",
            "old_email": "old@example.com",
            "phase": "legacy-phase",
            "email_change_phase": "old_email",
            "custom_marker": "preserve-me",
        },
    )

    data = TokenManager.get_token_data(token, "change_email")

    assert data is not None
    assert data.get("phase") == "legacy-phase"
    assert data.get("email_change_phase") == "old_email"
    assert data.get("custom_marker") == "preserve-me"


def test_token_manager_roundtrip_uses_explicit_email_with_account(monkeypatch: pytest.MonkeyPatch) -> None:
    """When both `account` and `email` are supplied, the token should bind the
    stable `account_id` from the account and the target email from the explicit
    email argument.
    """

    storage: dict[str, str] = {}
    monkeypatch.setattr(helper_module, "redis_client", _build_fake_redis(storage))

    account = SimpleNamespace(id="acc-1", email="old@example.com")

    token = TokenManager.generate_token(
        account=account,
        email="new@example.com",
        token_type="change_email",
        additional_data={
            "code": "654321",
            "old_email": "old@example.com",
            "email_change_phase": "new_email",
        },
    )

    data = TokenManager.get_token_data(token, "change_email")

    assert data is not None
    assert data.get("account_id") == "acc-1"
    assert data.get("email") == "new@example.com"
    assert data.get("old_email") == "old@example.com"
    assert data.get("email_change_phase") == "new_email"


def test_token_manager_roundtrip_still_validates_declared_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unknown fields should be preserved, but declared baseline fields should
    still be validated by `_token_data_adapter`.
    """

    storage = {
        "change_email:token:token-123": json.dumps(
            {
                "token_type": "change_email",
                "account_id": "acc-1",
                "email": ["not-a-string"],
                "code": "654321",
                "old_email": "old@example.com",
                "email_change_phase": "old_email",
            }
        )
    }
    monkeypatch.setattr(helper_module, "redis_client", _build_fake_redis(storage))

    with pytest.raises(ValidationError):
        TokenManager.get_token_data("token-123", "change_email")


def test_token_manager_roundtrip_validates_email_change_phase_as_string(monkeypatch: pytest.MonkeyPatch) -> None:
    """`email_change_phase` is part of the shared baseline schema, so obviously
    malformed discriminator values should fail before the change-email-specific
    union parsing at the callsite boundary.
    """

    storage = {
        "change_email:token:token-456": json.dumps(
            {
                "token_type": "change_email",
                "account_id": "acc-1",
                "email": "new@example.com",
                "code": "654321",
                "old_email": "old@example.com",
                "email_change_phase": ["not-a-string"],
            }
        )
    }
    monkeypatch.setattr(helper_module, "redis_client", _build_fake_redis(storage))

    with pytest.raises(ValidationError):
        TokenManager.get_token_data("token-456", "change_email")
