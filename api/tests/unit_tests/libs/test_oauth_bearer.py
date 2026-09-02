"""The bearer catalog: which subject each token type serves and what it may do."""

from __future__ import annotations

import pytest

from libs.oauth_bearer import Scope, SubjectType, TokenType


def test_each_token_type_serves_one_subject() -> None:
    assert TokenType.OAUTH_ACCOUNT.subject is SubjectType.ACCOUNT
    assert TokenType.OAUTH_EXTERNAL_SSO.subject is SubjectType.EXTERNAL_SSO


def test_scope_sets_are_pinned_exactly() -> None:
    assert SubjectType.ACCOUNT.scopes == frozenset({Scope.FULL})
    assert SubjectType.EXTERNAL_SSO.scopes == frozenset({Scope.APPS_RUN, Scope.APPS_READ_PERMITTED_EXTERNAL})


def test_the_permitted_external_scope_belongs_to_the_external_subject_only() -> None:
    """`dfoa_` relies on the `Scope.FULL` umbrella; the explicit scope is reserved for `dfoe_`."""
    assert Scope.APPS_READ_PERMITTED_EXTERNAL in SubjectType.EXTERNAL_SSO.scopes
    assert Scope.APPS_READ_PERMITTED_EXTERNAL not in SubjectType.ACCOUNT.scopes


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
