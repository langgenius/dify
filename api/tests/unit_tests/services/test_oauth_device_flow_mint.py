"""Minting normalises the issuer by the subject's declared account binding."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import create_autospec

import pytest

from constants.oauth_bearer import TokenType
from libs.oauth_bearer import sha256_hex
from services.entities.account_entities import AccountSnapshot
from services.oauth_device_adapters import OAuthDeviceTokenIssuanceGateway
from services.oauth_device_application_service import OAuthDeviceTokenPersistence, OAuthDeviceTokenTTLPolicy
from services.oauth_device_contracts import ACCOUNT_ISSUER_SENTINEL, OAuthDeviceTokenRotation


@pytest.mark.parametrize("token_type", list(TokenType), ids=lambda t: t.value)
def test_the_issuer_follows_the_subject_binding(token_type: TokenType) -> None:
    tokens = create_autospec(OAuthDeviceTokenPersistence, instance=True)
    tokens.rotate_token.return_value = OAuthDeviceTokenRotation(
        token_id="token-1", replaced_token_id=None, replaced_token_hash=None
    )
    ttl_policy = create_autospec(OAuthDeviceTokenTTLPolicy, instance=True)
    ttl_policy.ttl_days.return_value = 1
    gateway = OAuthDeviceTokenIssuanceGateway(tokens=tokens, ttl_policy=ttl_policy)

    if token_type.subject.bound_to_account:
        account = AccountSnapshot(
            id="account-1",
            name="Caller",
            email="who@example.com",
            avatar=None,
            is_password_set=True,
            interface_language=None,
            interface_theme=None,
            timezone=None,
            last_login_at=None,
            last_login_ip=None,
            status="active",
            initialized_at=None,
            created_at=datetime.now(UTC),
        )
        issued = gateway.issue_account_token(
            account=account, workspace_id="workspace-1", client_id="client", device_label="device"
        )
        expected_issuer = ACCOUNT_ISSUER_SENTINEL
        expected_account = account.id
    else:
        issued = gateway.issue_external_token(
            subject_email="who@example.com",
            subject_issuer="https://idp.example.com",
            client_id="client",
            device_label="device",
        )
        expected_issuer = "https://idp.example.com"
        expected_account = None

    tokens.rotate_token.assert_called_once()
    written = tokens.rotate_token.call_args.args[0]
    assert written.subject_issuer == expected_issuer
    assert written.account_id == expected_account
    assert written.prefix == token_type.prefix
    assert TokenType.for_token(issued.token) is token_type
    assert written.token_hash == sha256_hex(issued.token)


@pytest.mark.parametrize("issuer", ["", " "])
def test_external_issuer_is_required_before_persistence(issuer: str) -> None:
    tokens = create_autospec(OAuthDeviceTokenPersistence, instance=True)
    gateway = OAuthDeviceTokenIssuanceGateway(
        tokens=tokens, ttl_policy=create_autospec(OAuthDeviceTokenTTLPolicy, instance=True)
    )

    with pytest.raises(ValueError, match="subject_issuer"):
        gateway.issue_external_token(
            subject_email="who@example.com", subject_issuer=issuer, client_id="client", device_label="device"
        )

    tokens.rotate_token.assert_not_called()
