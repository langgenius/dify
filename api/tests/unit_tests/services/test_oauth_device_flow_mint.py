"""Minting normalises the issuer by the subject's declared account binding."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest

from libs.oauth_bearer import TokenType
from services.oauth_device_flow import ACCOUNT_ISSUER_SENTINEL, UpsertOutcome, mint_oauth_token

UPSERT = "services.oauth_device_flow._upsert"


def _mint(token_type: TokenType, subject_issuer: str | None) -> MagicMock:
    outcome = UpsertOutcome(token_id=uuid.uuid4(), rotated=False, old_hash=None)
    with patch(UPSERT, return_value=outcome) as upsert:
        mint_oauth_token(
            MagicMock(),
            subject_email="who@example.com",
            subject_issuer=subject_issuer,
            account_id=str(uuid.uuid4()) if token_type.subject.bound_to_account else None,
            client_id="client",
            device_label="device",
            token_type=token_type,
            ttl_days=1,
            session=MagicMock(),
        )
    return upsert


@pytest.mark.parametrize("token_type", list(TokenType), ids=lambda t: t.value)
def test_the_issuer_follows_the_subject_binding(token_type: TokenType) -> None:
    if token_type.subject.bound_to_account:
        upsert = _mint(token_type, None)
        assert upsert.call_args.kwargs["subject_issuer"] == ACCOUNT_ISSUER_SENTINEL
        with pytest.raises(ValueError, match="ACCOUNT_ISSUER_SENTINEL"):
            _mint(token_type, "https://idp.example.com")
    else:
        upsert = _mint(token_type, "https://idp.example.com")
        assert upsert.call_args.kwargs["subject_issuer"] == "https://idp.example.com"
        with pytest.raises(ValueError, match="subject_issuer"):
            _mint(token_type, " ")
