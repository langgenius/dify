"""Every guarded route on /openapi/v1 declares catalog metadata exactly once."""

import re

from flask import Flask

from controllers.openapi import bp as openapi_bp
from controllers.openapi.auth.spec import EndpointSpec

OP_ID_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
_VERBS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
_UNCATALOGUED_PREFIX = "/openapi/v1/oauth/"
_UNCATALOGUED = {
    "/openapi/v1/",
    "/openapi/v1/openapi.json",
    "/openapi/v1/_health",
    "/openapi/v1/_version",
    "/openapi/v1/_catalog",
}


def _view_methods(app: Flask):
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/openapi/v1"):
            continue
        view = app.view_functions.get(rule.endpoint)
        cls = getattr(view, "view_class", None)
        if cls is None:
            continue
        for verb in (rule.methods or set()) & _VERBS:
            yield rule, verb, getattr(cls, verb.lower())


def test_every_guarded_route_declares_catalog_meta():
    app = Flask(__name__)
    app.register_blueprint(openapi_bp)
    missing = []
    seen: dict[str, str] = {}
    for rule, verb, fn in _view_methods(app):
        spec = getattr(fn, "__spec__", None)
        if rule.rule.startswith(_UNCATALOGUED_PREFIX) or rule.rule in _UNCATALOGUED:
            assert spec is None, f"{verb} {rule.rule} must stay out of the catalog"
            continue
        if not isinstance(spec, EndpointSpec):
            missing.append(f"{verb} {rule.rule}")
            continue
        assert OP_ID_RE.fullmatch(spec.op), spec.op
        assert spec.summary.strip(), f"{spec.op} needs a summary"
        assert spec.op not in seen, f"{spec.op} declared twice: {seen[spec.op]} and {verb} {rule.rule}"
        seen[spec.op] = f"{verb} {rule.rule}"
    assert missing == []
