"""Verifies the OPENAPI_ENABLED gate in `extensions.ext_blueprints.init_app`.

Contract:
- When `dify_config.OPENAPI_ENABLED` is True, the `/openapi/v1/*` blueprint
  must be registered on the Flask app AND have CORS configured (signalled
  by the idempotent `_dify_cors_applied` marker that `_apply_cors_once`
  sets after wiring `flask_cors.CORS`).
- When False, the openapi blueprint must NOT be registered and CORS must
  NOT be wired for it. The cross-origin posture is otherwise undefined for
  the disabled feature.

The openapi blueprint is a module-level singleton; tests reset its
`_dify_cors_applied` flag so each case re-evaluates the branching logic.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from configs import dify_config
from controllers.openapi import bp as openapi_bp
from dify_app import DifyApp
from extensions import ext_blueprints


@pytest.fixture
def fresh_openapi_cors_state() -> Iterator[None]:
    """Reset the one-shot CORS marker on the openapi blueprint.

    `_apply_cors_once` short-circuits when this flag is truthy, so we
    must clear it before each case to actually exercise the True branch.
    """
    had_flag = hasattr(openapi_bp, "_dify_cors_applied")
    if had_flag:
        delattr(openapi_bp, "_dify_cors_applied")
    yield
    # Leave the blueprint in a clean state regardless of branch taken,
    # so unrelated tests that import the production blueprint do not
    # observe leaked state from this module.
    if hasattr(openapi_bp, "_dify_cors_applied"):
        delattr(openapi_bp, "_dify_cors_applied")


def _build_app() -> DifyApp:
    app = DifyApp(__name__)
    app.config["TESTING"] = True
    return app


def test_openapi_blueprint_registered_with_cors_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    fresh_openapi_cors_state: None,
) -> None:
    """Enabled gate: blueprint mounted, CORS wired, `/openapi/v1/*` rules live.

    Combined into one case because `flask_cors.CORS(bp, ...)` calls
    `bp.after_request(...)`, which Flask rejects after the singleton
    blueprint has been registered to any app once. So this branch is
    only safe to exercise a single time per test process.
    """
    monkeypatch.setattr(dify_config, "OPENAPI_ENABLED", True)

    app = _build_app()
    ext_blueprints.init_app(app)

    assert "openapi" in app.blueprints
    assert app.blueprints["openapi"] is openapi_bp
    # `_apply_cors_once` only sets this after wiring flask_cors.CORS, so
    # it is a faithful proxy for "CORS was applied to this blueprint".
    assert getattr(openapi_bp, "_dify_cors_applied", False) is True

    openapi_rules = [r for r in app.url_map.iter_rules() if r.rule.startswith("/openapi/v1")]
    assert openapi_rules, "expected at least one /openapi/v1/* route once enabled"


def test_openapi_blueprint_absent_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
    fresh_openapi_cors_state: None,
) -> None:
    """Disabled gate: no blueprint, no CORS, no `/openapi/v1/*` URL rules."""
    monkeypatch.setattr(dify_config, "OPENAPI_ENABLED", False)

    app = _build_app()
    ext_blueprints.init_app(app)

    assert "openapi" not in app.blueprints
    # No CORS wiring should have run for the openapi blueprint.
    assert not hasattr(openapi_bp, "_dify_cors_applied")
    openapi_rules = [r for r in app.url_map.iter_rules() if r.rule.startswith("/openapi/v1")]
    assert openapi_rules == []
