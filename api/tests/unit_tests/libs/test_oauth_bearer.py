"""Unit tests for the openapi bearer-scope catalog and TokenKind registry."""

from __future__ import annotations

from constants.oauth_bearer import Scope
from libs.oauth_bearer import build_registry


def test_apps_read_permitted_external_scope_present():
    assert Scope.APPS_READ_PERMITTED_EXTERNAL.value == "apps:read:permitted-external"


def test_dfoe_token_kind_carries_apps_read_permitted_external():
    registry = build_registry(object(), object())
    dfoe = next(k for k in registry.kinds() if k.prefix == "dfoe_")
    assert Scope.APPS_READ_PERMITTED_EXTERNAL in dfoe.scopes


def test_dfoa_token_kind_does_not_carry_apps_read_permitted_external():
    """dfoa_ relies on Scope.FULL umbrella; the explicit permitted scope
    is reserved for dfoe_."""
    registry = build_registry(object(), object())
    dfoa = next(k for k in registry.kinds() if k.prefix == "dfoa_")
    assert Scope.APPS_READ_PERMITTED_EXTERNAL not in dfoa.scopes
