"""The bearer catalog: which subject each token type serves and what it may do."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from libs.oauth_bearer import ResolvedRow, Scope, SubjectType, TokenType, _TokenTypeResolver


def _row(account_id: uuid.UUID | None) -> ResolvedRow:
    return ResolvedRow(
        subject_email="who@example.com",
        subject_issuer="issuer",
        account_id=account_id,
        client_id="client",
        token_id=uuid.uuid4(),
        expires_at=datetime.now(UTC),
    )


@pytest.mark.parametrize("token_type", list(TokenType), ids=lambda t: t.value)
def test_a_row_matches_its_subject_only_when_its_account_binding_agrees(token_type: TokenType) -> None:
    """Every token type, present or future, is held to the binding its subject declares."""
    resolver = _TokenTypeResolver(MagicMock(), token_type)
    bound = token_type.subject.bound_to_account
    assert resolver._matches_subject(_row(uuid.uuid4())) is bound
    assert resolver._matches_subject(_row(None)) is not bound


def test_scope_sets_are_pinned_exactly() -> None:
    """`dfoa_` relies on the `Scope.FULL` umbrella; the explicit scopes are reserved for `dfoe_`."""
    assert SubjectType.ACCOUNT.scopes == frozenset({Scope.FULL})
    assert SubjectType.EXTERNAL_SSO.scopes == frozenset({Scope.APPS_RUN, Scope.APPS_READ_PERMITTED_EXTERNAL})


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        ("dfoa_abc", TokenType.OAUTH_ACCOUNT),
        ("dfoe_abc", TokenType.OAUTH_EXTERNAL_SSO),
        ("dfp_abc", None),
        ("", None),
    ],
)
def test_for_token_classifies_by_prefix_and_refuses_the_rest(token: str, expected: TokenType | None) -> None:
    assert TokenType.for_token(token) is expected
