"""Which token kinds a route can ever admit, as each requirement and the PAT policy answer it."""

from __future__ import annotations

import pytest

from constants.oauth_bearer import Scope, TokenType
from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi.auth.requirements import CheckAppApiEnabled, CheckScope, CheckSubject, Requirement
from controllers.openapi.auth.spec import CatalogMeta, EndpointSpec, Kind
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject, ResourceAccessSubject


def _spec(*, pat_policy: PersonalAccessTokenPolicy | None, requirements: tuple[Requirement, ...] = ()) -> EndpointSpec:
    return EndpointSpec(
        requirements=requirements,
        catalog=CatalogMeta(op="get.thing", summary="", kind=Kind.OBJECT),
        pat_policy=pat_policy,
    )


@pytest.mark.parametrize("token_type", list(TokenType))
def test_a_requirement_with_no_rule_about_token_kinds_admits_every_kind(token_type: TokenType) -> None:
    assert CheckAppApiEnabled().admits(token_type)


def test_the_subject_check_admits_only_the_kinds_of_its_subjects() -> None:
    check = CheckSubject(allowed=(AccountSubject, ResourceAccessSubject))

    admitted = {token_type for token_type in TokenType if check.admits(token_type)}

    assert admitted == {TokenType.OAUTH_ACCOUNT, TokenType.PERSONAL_ACCESS, TokenType.RESOURCE_ACCESS}
    assert not CheckSubject(allowed=(ExternalSsoSubject,)).admits(TokenType.OAUTH_ACCOUNT)


def test_the_scope_check_admits_a_kind_whose_subject_holds_the_scope_or_full() -> None:
    check = CheckScope(Scope.WORKSPACE_READ)

    admitted = {token_type for token_type in TokenType if check.admits(token_type)}

    assert admitted == {TokenType.OAUTH_ACCOUNT, TokenType.PERSONAL_ACCESS, TokenType.RESOURCE_ACCESS}


def test_a_route_without_a_pat_policy_admits_no_personal_token() -> None:
    assert not _spec(pat_policy=None).admits(TokenType.PERSONAL_ACCESS)
    assert _spec(pat_policy=None).admits(TokenType.OAUTH_ACCOUNT)
    assert _spec(pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS).admits(TokenType.PERSONAL_ACCESS)


def test_a_route_admits_a_kind_only_when_every_requirement_does() -> None:
    spec = _spec(
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        requirements=(CheckSubject(allowed=(AccountSubject, ExternalSsoSubject)), CheckScope(Scope.WORKSPACE_READ)),
    )

    admitted = {token_type for token_type in TokenType if spec.admits(token_type)}

    assert admitted == {TokenType.OAUTH_ACCOUNT, TokenType.PERSONAL_ACCESS}
