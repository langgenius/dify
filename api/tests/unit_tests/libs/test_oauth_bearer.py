"""Unit tests for the openapi bearer-scope catalog and TokenKind registry."""

from __future__ import annotations

from unittest.mock import MagicMock


def test_apps_read_permitted_external_scope_present():
    from libs.oauth_bearer import Scope

    assert Scope.APPS_READ_PERMITTED_EXTERNAL.value == "apps:read:permitted-external"


def test_dfoe_token_kind_carries_apps_read_permitted_external():
    from libs.oauth_bearer import Scope, build_registry

    registry = build_registry(MagicMock(), MagicMock())
    dfoe = next(k for k in registry.kinds() if k.prefix == "dfoe_")
    assert Scope.APPS_READ_PERMITTED_EXTERNAL in dfoe.scopes


def test_dfoa_token_kind_does_not_carry_apps_read_permitted_external():
    """dfoa_ relies on Scope.FULL umbrella; the explicit permitted scope
    is reserved for dfoe_."""
    from libs.oauth_bearer import Scope, build_registry

    registry = build_registry(MagicMock(), MagicMock())
    dfoa = next(k for k in registry.kinds() if k.prefix == "dfoa_")
    assert Scope.APPS_READ_PERMITTED_EXTERNAL not in dfoa.scopes
