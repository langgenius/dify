"""PAT workspace discovery grants are pure projections of the token's scopes."""

from typing import Literal

import pytest

from machinery.scope import UNRESTRICTED
from services.personal_access_token_service import (
    PersonalAccessTokenResourceRef,
    PersonalAccessTokenScopes,
    workspace_discovery_ids,
    workspace_scope_ids,
)

WORKSPACE_A = "workspace-a"
WORKSPACE_B = "workspace-b"
WORKSPACE_C = "workspace-c"
APP = PersonalAccessTokenResourceRef("app", "app-1")
ScopeMode = Literal["all", "selected", "none"]


def _scopes(
    *,
    resource_mode: ScopeMode,
    workspace_mode: ScopeMode,
    workspace_ids: tuple[str, ...] = (),
) -> PersonalAccessTokenScopes:
    return PersonalAccessTokenScopes(
        resource_mode=resource_mode,
        resources=(APP,) if resource_mode == "selected" else (),
        workspace_mode=workspace_mode,
        workspace_ids=workspace_ids,
    )


@pytest.mark.parametrize(
    ("workspace_mode", "workspace_ids"),
    [("all", ()), ("selected", (WORKSPACE_A,)), ("none", ())],
)
def test_workspace_discovery_resource_all_is_unrestricted(
    workspace_mode: ScopeMode, workspace_ids: tuple[str, ...]
) -> None:
    scopes = _scopes(resource_mode="all", workspace_mode=workspace_mode, workspace_ids=workspace_ids)
    assert workspace_discovery_ids(scopes, frozenset({WORKSPACE_B})) is UNRESTRICTED


def test_workspace_discovery_selected_resources_expose_owner_workspaces() -> None:
    scopes = _scopes(resource_mode="selected", workspace_mode="none")
    assert workspace_discovery_ids(scopes, frozenset({WORKSPACE_B, WORKSPACE_C})) == frozenset(
        {WORKSPACE_B, WORKSPACE_C}
    )


def test_workspace_discovery_unions_workspace_scope_and_resource_owners() -> None:
    scopes = _scopes(resource_mode="selected", workspace_mode="selected", workspace_ids=(WORKSPACE_A,))
    assert workspace_discovery_ids(scopes, frozenset({WORKSPACE_B})) == frozenset({WORKSPACE_A, WORKSPACE_B})


def test_workspace_discovery_without_any_scope_is_empty() -> None:
    scopes = _scopes(resource_mode="none", workspace_mode="none")
    assert workspace_discovery_ids(scopes, frozenset({WORKSPACE_B})) == frozenset()


def test_workspace_discovery_workspace_all_wins_over_resource_scope() -> None:
    scopes = _scopes(resource_mode="selected", workspace_mode="all")
    assert workspace_discovery_ids(scopes, frozenset({WORKSPACE_B})) is UNRESTRICTED


def test_workspace_scope_ids_ignores_resource_owners() -> None:
    assert workspace_scope_ids(_scopes(resource_mode="selected", workspace_mode="none")) == frozenset()
    assert workspace_scope_ids(
        _scopes(resource_mode="selected", workspace_mode="selected", workspace_ids=(WORKSPACE_A,))
    ) == frozenset({WORKSPACE_A})
    assert workspace_scope_ids(_scopes(resource_mode="selected", workspace_mode="all")) is UNRESTRICTED
