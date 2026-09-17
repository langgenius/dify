import hashlib
import json
from collections.abc import Iterator

import pytest
from flask import Flask
from pydantic import BaseModel

from controllers.openapi import bp as openapi_bp
from controllers.openapi._catalog import (
    CATALOG_HEADER,
    CATALOG_PATH,
    build_catalog,
    catalog_for,
    inline_refs,
    op_input_schema,
)


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
