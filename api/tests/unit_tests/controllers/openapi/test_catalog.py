import hashlib
import json
from collections.abc import Iterator

import pytest
from flask import Flask
from pydantic import BaseModel

from configs import dify_config
from controllers.openapi import bp as openapi_bp
from controllers.openapi._catalog import (
    _VERBS,
    CATALOG_HEADER,
    CATALOG_PATH,
    _catalog_path,
    build_catalog,
    catalog_for,
    inline_refs,
    op_input_schema,
)
from controllers.openapi.auth.spec import EndpointSpec
from enums import DeploymentEdition
from tests.unit_tests.config_override import apply_config_overrides


@pytest.fixture
def app() -> Flask:
    a = Flask(__name__)
    a.config["TESTING"] = True
    a.register_blueprint(openapi_bp)
    return a


def _nodes(node: object) -> Iterator[dict[str, object]]:
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _nodes(value)
    elif isinstance(node, list):
        for item in node:
            yield from _nodes(item)


def _stamped_ops_for_current_edition(app: Flask) -> set[str]:
    """Every op a route on the url map carries, that the running edition admits.

    Independent of `build_catalog`'s own traversal, so a bug that silently drops or
    duplicates an op is caught by comparing against this.
    """
    ops: set[str] = set()
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/openapi/v1"):
            continue
        cls = getattr(app.view_functions.get(rule.endpoint), "view_class", None)
        if cls is None:
            continue
        for verb in (rule.methods or set()) & _VERBS:
            spec = getattr(cls, verb.lower(), None)
            spec = getattr(spec, "__spec__", None)
            if not isinstance(spec, EndpointSpec):
                continue
            if spec.edition is None or dify_config.DEPLOYMENT_EDITION in spec.edition:
                ops.add(spec.op)
    return ops


def test_catalog_lists_every_stamped_op_with_full_path(app: Flask):
    doc = build_catalog(app)
    run = doc["ops"]["console_app.run"]
    assert run["method"] == "POST"
    assert run["path"] == "/openapi/v1/apps/{app_id}:run"
    assert run["kind"] == "sse"
    assert run["input"]["properties"]["app_id"] == {"type": "string"}
    assert "app_id" in run["input"]["required"]
    assert "inputs" in run["input"]["required"]
    assert run["bind"] == {name: run["bind"][name] for name in run["input"]["properties"]}
    assert run["bind"]["app_id"] == "path"
    assert run["bind"]["files"] == "file"
    assert run["bind"]["inputs"] == "body"
    assert run["tags"] == ["console_app"]
    assert run["internal"] is False
    assert run["deprecated"] is False
    assert set(run) == {"summary", "method", "path", "kind", "input", "bind", "tags", "internal", "deprecated"}


def test_get_and_delete_bind_to_query(app: Flask):
    ops = build_catalog(app)["ops"]
    assert ops["console_app.list"]["bind"]["page"] == "query"
    assert ops["account.sessions.revoke"]["bind"] == {"session_id": "path"}
    assert ops["run.events"]["bind"]["continue_on_pause"] == "query"


def test_catalog_has_no_refs_or_defs(app: Flask):
    for op, entry in build_catalog(app)["ops"].items():
        for node in _nodes(entry["input"]):
            assert "$ref" not in node, op
            assert "$defs" not in node, op
        assert "additionalProperties" not in entry["input"], op


def test_catalog_marks_internal_and_excludes_probes_and_oauth(app: Flask):
    doc = build_catalog(app)
    assert doc["ops"]["workspace.switch"]["internal"] is True
    paths = {p["path"] for p in doc["ops"].values()}
    assert not any(p.startswith("/openapi/v1/oauth/") for p in paths)
    assert not paths & {"/openapi/v1/_health", "/openapi/v1/_version", "/openapi/v1/_catalog"}


def test_catalog_matches_every_stamped_op_for_the_current_edition(app: Flask):
    assert set(build_catalog(app)["ops"]) == _stamped_ops_for_current_edition(app)


def test_edition_gated_op_appears_only_under_its_own_edition(app: Flask, monkeypatch: pytest.MonkeyPatch):
    op = "console_app.external.list"
    assert op not in build_catalog(app)["ops"]

    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    assert op in build_catalog(app)["ops"]


def test_inline_refs_resolves_nested_ref_chain():
    schema = {
        "properties": {"x": {"$ref": "#/$defs/A"}},
        "$defs": {"A": {"properties": {"y": {"$ref": "#/$defs/B"}}}, "B": {"type": "string"}},
    }
    assert inline_refs(schema) == {"properties": {"x": {"properties": {"y": {"type": "string"}}}}}


def test_inline_refs_rejects_recursion():
    schema = {"properties": {"x": {"$ref": "#/$defs/A"}}, "$defs": {"A": {"properties": {"me": {"$ref": "#/$defs/A"}}}}}
    with pytest.raises(ValueError, match="recursive"):
        inline_refs(schema)


def test_name_clash_raises():
    class _Q(BaseModel):
        app_id: str

    with pytest.raises(ValueError, match="app_id"):
        op_input_schema(path_params=["app_id"], query=_Q, body=None)


def test_bytes_are_canonical_and_fingerprint_matches(app: Flask):
    raw, fingerprint = catalog_for(app)
    assert raw == json.dumps(build_catalog(app), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    assert fingerprint == hashlib.sha256(raw).hexdigest()
    assert catalog_for(app) == (raw, fingerprint)


def test_catalog_route_serves_bytes_without_auth(app: Flask):
    client = app.test_client()
    res = client.get(CATALOG_PATH)
    raw, fingerprint = catalog_for(app)
    assert res.status_code == 200
    assert res.mimetype == "application/json"
    assert res.data == raw
    assert res.headers[CATALOG_HEADER] == fingerprint


def test_every_openapi_response_carries_fingerprint(app: Flask):
    client = app.test_client()
    _, fingerprint = catalog_for(app)
    assert client.get("/openapi/v1/_health").headers[CATALOG_HEADER] == fingerprint
    assert client.get("/openapi/v1/apps").headers[CATALOG_HEADER] == fingerprint  # 401, still stamped
    assert client.get("/openapi/v1/does-not-exist").headers[CATALOG_HEADER] == fingerprint


def test_catalog_route_is_allowlisted_from_version_gate(app: Flask):
    client = app.test_client()
    res = client.get(CATALOG_PATH, headers={"User-Agent": "difyctl/0.0.1 (x; y; z)"})
    assert res.status_code == 200


def test_a_neighbouring_prefix_is_not_stamped(app: Flask):
    """`/openapi/v1beta` is a different surface; the fingerprint says nothing about it."""

    @app.get("/openapi/v1beta/x")
    def _beta() -> str:
        return "ok"

    response = app.test_client().get("/openapi/v1beta/x")
    assert response.status_code == 200
    assert CATALOG_HEADER not in response.headers


def test_catalog_path_converts_a_plain_placeholder():
    assert _catalog_path("/openapi/v1/apps/<string:app_id>", arguments={"app_id"}) == "/openapi/v1/apps/{app_id}"


def test_catalog_path_refuses_a_converter_it_cannot_read():
    """A converter carrying arguments would otherwise reach the published path raw."""
    with pytest.raises(ValueError, match="placeholders"):
        _catalog_path("/openapi/v1/things/<int(min=1):n>", arguments={"n"})
