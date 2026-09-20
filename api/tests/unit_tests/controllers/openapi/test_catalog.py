"""The catalog on /openapi/v1: every guarded route is in it, and its schemas are a shape an agent can read raw."""

import hashlib
import re
from collections.abc import Iterator

import pytest
from flask import Flask
from flask_restx.model import ModelBase

from configs import dify_config
from controllers.common.fields import EventStreamResponse
from controllers.openapi import bp as openapi_bp
from controllers.openapi._catalog import (
    CATALOG_HEADER,
    CATALOG_PATH,
    CatalogOp,
    build_catalog,
    catalog_for,
    iter_handlers,
)
from controllers.openapi._errors import OpenApiErrorCode
from controllers.openapi._models import Hinted
from controllers.openapi.auth.spec import EndpointSpec, Kind, spec_of
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld

OP_ID_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
MAX_DEPTH = 4
_UNCATALOGUED_PREFIX = "/openapi/v1/oauth/"
_UNCATALOGUED = {
    "/openapi/v1/",
    "/openapi/v1/openapi.json",
    "/openapi/v1/_health",
    "/openapi/v1/_version",
    CATALOG_PATH,
}


@pytest.fixture
def app() -> Flask:
    a = Flask(__name__)
    a.config["TESTING"] = True
    a.register_blueprint(openapi_bp)
    return a


@pytest.fixture
def ops(app: Flask) -> dict[str, CatalogOp]:
    return build_catalog(app)["ops"]


def _response_model_names(fn: object) -> set[str]:
    responses: dict[str, tuple[object, ...]] = vars(fn).get("__apidoc__", {}).get("responses", {})
    return {entry[1].name for entry in responses.values() if isinstance(entry[1], ModelBase)}


def _walk(
    node: object, path: tuple[str, ...] = (), depth: int = 0
) -> Iterator[tuple[tuple[str, ...], int, dict[str, object]]]:
    if isinstance(node, dict):
        yield path, depth, node
        for key in ("properties", "$defs"):
            for name, child in (node.get(key) or {}).items():
                yield from _walk(child, (*path, name), depth + 1)
        for key in ("items", "additionalProperties"):
            if isinstance(node.get(key), dict):
                yield from _walk(node[key], (*path, key), depth + 1)
        for alt in node.get("anyOf") or []:
            yield from _walk(alt, path, depth)


def test_every_guarded_route_declares_catalog_meta_once(app: Flask, ops: dict[str, CatalogOp]) -> None:
    seen: dict[str, str] = {}
    streaming: set[str] = set()
    for rule, verb, fn in iter_handlers(app):
        spec = spec_of(fn)
        if rule.rule.startswith(_UNCATALOGUED_PREFIX) or rule.rule in _UNCATALOGUED:
            assert spec is None, f"{verb} {rule.rule} must stay out of the catalog"
            continue
        assert isinstance(spec, EndpointSpec), f"{verb} {rule.rule}"
        assert OP_ID_RE.fullmatch(spec.op), spec.op
        assert spec.summary.strip(), spec.op
        assert spec.op not in seen, f"{spec.op} declared twice: {seen[spec.op]} and {verb} {rule.rule}"
        seen[spec.op] = f"{verb} {rule.rule}"
        admitted = spec.edition is None or dify_config.DEPLOYMENT_EDITION in spec.edition
        assert (spec.op in ops) is admitted, spec.op
        if EventStreamResponse.__name__ in _response_model_names(fn):
            streaming.add(spec.op)
            assert spec.kind is Kind.SSE, spec.op
    assert set(ops) <= set(seen)
    per_mode = {f"console_app.{mode}.run" for mode in ("workflow", "chat", "advanced_chat", "completion")}
    assert streaming == per_mode | {"console_app.run", "run.events"}


def test_run_entries_carry_path_bind_kind_and_flags(ops: dict[str, CatalogOp]) -> None:
    chat = ops["console_app.chat.run"]
    assert set(chat) == {"summary", "method", "path", "kind", "input", "bind", "tags", "internal", "deprecated"}
    assert (chat["method"], chat["path"], chat["kind"], chat["tags"]) == (
        "POST",
        "/openapi/v1/apps/{app_id}/chat:run",
        "sse",
        ["console_app"],
    )
    assert {"app_id", "inputs", "query"} <= set(chat["input"]["required"])
    assert set(chat["bind"]) == set(chat["input"]["properties"])
    assert {k: chat["bind"][k] for k in ("app_id", "inputs", "files", "attachments")} == {
        "app_id": "path",
        "inputs": "body",
        "files": "file",
        "attachments": "file",
    }
    assert (ops["console_app.run"]["deprecated"], chat["deprecated"]) == (True, False)
    assert ops["console_app.file.upload"]["bind"]["file"] == "file"
    assert ops["console_app.list"]["bind"]["page"] == "query"
    assert ops["run.events"]["bind"]["continue_on_pause"] == "query"
    assert ops["workspace.switch"]["internal"] is True


def test_input_schemas_are_flat_shallow_and_described(ops: dict[str, CatalogOp]) -> None:
    bad = [
        (op, p, k)
        for op, e in ops.items()
        for p, d, n in _walk(e["input"])
        for k in ("oneOf", "$ref", "$defs")
        if k in n or d > MAX_DEPTH
    ]
    assert bad == []
    undocumented = [
        (op, name)
        for op, e in ops.items()
        for name, prop in e["input"]["properties"].items()
        if "object" in {prop.get("type")} | {a.get("type") for a in prop.get("anyOf", [])}
        and not prop.get("description")
    ]
    assert undocumented == []
    assert [
        op for op, e in ops.items() if e["kind"] == "list" and not {"page", "limit"} <= set(e["input"]["properties"])
    ] == []
    assert [op for op, e in ops.items() if set(Hinted.model_fields) & set(e["input"]["properties"])] == []
    desc = ops["console_app.chat.run"]["input"]["properties"]["inputs"]["description"]
    assert "console_app.describe" in desc
    assert "input_schema" in desc


def test_catalog_route_serves_canonical_bytes_and_every_response_carries_the_fingerprint(app: Flask) -> None:
    client = app.test_client()
    raw, fingerprint = catalog_for(app)
    res = client.get(CATALOG_PATH)
    assert (res.status_code, res.mimetype, res.data) == (200, "application/json", raw)
    assert fingerprint == hashlib.sha256(raw).hexdigest() == res.headers[CATALOG_HEADER]
    assert client.get("/openapi/v1/apps").headers[CATALOG_HEADER] == fingerprint
    assert client.get("/openapi/v1/does-not-exist").headers[CATALOG_HEADER] == fingerprint


def test_a_guarded_route_refuses_a_request_that_does_not_name_the_current_catalog(
    admitted_bearer: AdmittedWorld,
) -> None:
    """The wire shape of the refusal: 412 with the canonical body, and the
    current fingerprint on the response so the client can refetch and retry.
    The same bearer with the current fingerprint gets past the guard: the
    unknown query answers 422 from `@accepts`, which sits inside it.
    """
    path = f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/members?nope=1"
    current = admitted_bearer.headers[CATALOG_HEADER]
    without = {"Authorization": admitted_bearer.headers["Authorization"]}

    refused = admitted_bearer.client.get(path, headers=without)
    admitted = admitted_bearer.client.get(path, headers=admitted_bearer.headers)

    assert refused.status_code == 412
    assert refused.get_json()["code"] == OpenApiErrorCode.CATALOG_STALE
    assert refused.headers[CATALOG_HEADER] == current
    assert admitted.status_code == 422
