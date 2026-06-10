"""Verifies the OPENAPI_ENABLED gate in `extensions.ext_blueprints.init_app`.

Contract:
- When `dify_config.OPENAPI_ENABLED` is True, the `/openapi/v1/*` blueprint
  must be registered on the Flask app AND have CORS configured (signalled
  by the idempotent `_dify_cors_applied` marker that `_apply_cors_once`
  sets after wiring `flask_cors.CORS`).
- When False, the openapi blueprint must NOT be registered and CORS must
  NOT be wired for it. The cross-origin posture is otherwise undefined for
  the disabled feature.

Why the blueprints are swapped for fresh ones:
`init_app` operates on module-level blueprint singletons (e.g.
`controllers.service_api.bp`). Other unit tests register those same
singletons onto throwaway Flask apps without going through `init_app`
(see `tests/unit_tests/controllers/test_swagger.py` and the
`tests/unit_tests/controllers/openapi/*` suite). Once a blueprint has
been registered to any app, Flask flips `_got_registered_once = True`
and rejects further `after_request` hookup -- which is what
`flask_cors.CORS(bp, ...)` does internally. To make this gate test
order-independent we monkeypatch each consumed `controllers.<ns>.bp` to
a pristine, never-registered `Blueprint` for the duration of the test.
`init_app` resolves these via `from controllers.<ns> import bp as ...`
inside its function body, so the patched value is what it sees.
"""

from __future__ import annotations

import importlib
from collections.abc import Iterator

import pytest
from flask import Blueprint

from configs import dify_config
from dify_app import DifyApp
from extensions import ext_blueprints

# Modules whose `bp` attribute is consumed by `ext_blueprints.init_app`.
# Keep in sync with the imports inside `init_app`.
_BLUEPRINT_MODULES: tuple[str, ...] = (
    "controllers.console",
    "controllers.files",
    "controllers.inner_api",
    "controllers.mcp",
    "controllers.openapi",
    "controllers.service_api",
    "controllers.trigger",
    "controllers.web",
)


def _probe_view() -> tuple[str, int]:
    return "ok", 200


@pytest.fixture
def fresh_blueprints(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Blueprint]]:
    """Replace each production blueprint singleton with a fresh, unregistered copy.

    Mirrors the production `name` and `url_prefix` so the gate can still
    be asserted via `app.blueprints[...]` and url_map prefix checks. The
    openapi replacement gets a dummy `/_probe` rule so the test can
    observe at least one `/openapi/v1/*` rule after registration.
    """
    fresh: dict[str, Blueprint] = {}
    for module_name in _BLUEPRINT_MODULES:
        module = importlib.import_module(module_name)
        original = module.bp
        replacement = Blueprint(
            original.name,
            original.import_name,
            url_prefix=original.url_prefix,
        )
        if module_name == "controllers.openapi":
            replacement.add_url_rule("/_probe", endpoint="_probe", view_func=_probe_view)
        monkeypatch.setattr(module, "bp", replacement)
        fresh[module_name] = replacement
    return fresh


def _build_app() -> DifyApp:
    app = DifyApp(__name__)
    app.config["TESTING"] = True
    return app


def test_openapi_blueprint_registered_with_cors_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    fresh_blueprints: dict[str, Blueprint],
) -> None:
    """Enabled gate: blueprint mounted, CORS wired, `/openapi/v1/*` rules live."""
    monkeypatch.setattr(dify_config, "OPENAPI_ENABLED", True)

    app = _build_app()
    ext_blueprints.init_app(app)

    openapi_bp = fresh_blueprints["controllers.openapi"]
    assert "openapi" in app.blueprints
    assert app.blueprints["openapi"] is openapi_bp
    # `_apply_cors_once` only sets this after wiring flask_cors.CORS, so
    # it is a faithful proxy for "CORS was applied to this blueprint".
    assert getattr(openapi_bp, "_dify_cors_applied", False) is True

    openapi_rules = [r for r in app.url_map.iter_rules() if r.rule.startswith("/openapi/v1")]
    assert openapi_rules, "expected at least one /openapi/v1/* route once enabled"


def test_openapi_blueprint_absent_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
    fresh_blueprints: dict[str, Blueprint],
) -> None:
    """Disabled gate: no blueprint, no CORS, no `/openapi/v1/*` URL rules."""
    monkeypatch.setattr(dify_config, "OPENAPI_ENABLED", False)

    app = _build_app()
    ext_blueprints.init_app(app)

    openapi_bp = fresh_blueprints["controllers.openapi"]
    assert "openapi" not in app.blueprints
    # No CORS wiring should have run for the openapi blueprint.
    assert not hasattr(openapi_bp, "_dify_cors_applied")
    openapi_rules = [r for r in app.url_map.iter_rules() if r.rule.startswith("/openapi/v1")]
    assert openapi_rules == []
