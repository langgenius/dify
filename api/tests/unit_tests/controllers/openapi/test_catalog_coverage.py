"""Every guarded route on /openapi/v1 declares catalog metadata exactly once."""

import re

from flask import Flask

from controllers.common.fields import EventStreamResponse
from controllers.openapi import bp as openapi_bp
from controllers.openapi.auth.spec import EndpointSpec, Kind

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


def _response_model_names(fn) -> set[str]:
    """`@returns` registers each response through `openapi_ns.response`, which stores
    `(description, SchemaModel, ...)` on `__apidoc__`; the model's `name` is the
    Pydantic class's. `functools.wraps` carries it out to the guarded view.
    """
    responses = getattr(fn, "__apidoc__", {}).get("responses", {})
    return {getattr(entry[1], "name", "") for entry in responses.values() if isinstance(entry, tuple)}


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


def test_every_event_stream_route_declares_the_sse_kind():
    """`kind` is the only thing the CLI switches its reader on, so a route that answers
    an event stream while calling itself an object would be read as one JSON body.
    """
    app = Flask(__name__)
    app.register_blueprint(openapi_bp)
    streaming: set[str] = set()
    for rule, verb, fn in _view_methods(app):
        spec = getattr(fn, "__spec__", None)
        if not isinstance(spec, EndpointSpec):
            continue
        if EventStreamResponse.__name__ not in _response_model_names(fn):
            continue
        streaming.add(spec.op)
        assert spec.kind is Kind.SSE, f"{verb} {rule.rule} returns an event stream but declares {spec.kind}"
    assert streaming == {"console_app.run", "run.events"}
