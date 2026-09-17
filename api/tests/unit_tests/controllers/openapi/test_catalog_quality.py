"""Gate on the schemas an agent reads raw. Spec: 参数 item 5."""

from collections.abc import Iterator

import pytest
from flask import Flask

from controllers.openapi import bp as openapi_bp
from controllers.openapi._catalog import build_catalog

MAX_DEPTH = 4
DESCRIBE_OP = "console_app.describe"
RUN_OP = "console_app.run"


@pytest.fixture(scope="module")
def ops() -> dict[str, object]:
    app = Flask(__name__)
    app.register_blueprint(openapi_bp)
    return build_catalog(app)["ops"]


def _walk(node: object, path: tuple[str, ...] = (), depth: int = 0) -> Iterator[tuple[tuple[str, ...], int, dict]]:
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


def test_nesting_depth_at_most_four(ops):
    too_deep = [(op, p) for op, e in ops.items() for p, d, _ in _walk(e["input"]) if d > MAX_DEPTH]
    assert too_deep == []


def test_no_oneof_and_no_refs(ops):
    bad = [(op, p, k) for op, e in ops.items() for p, _, n in _walk(e["input"]) for k in ("oneOf", "$ref") if k in n]
    assert bad == []


def test_object_fields_have_descriptions(ops):
    missing = []
    for op, e in ops.items():
        for name, prop in e["input"]["properties"].items():
            types = {prop.get("type")} | {a.get("type") for a in prop.get("anyOf", [])}
            if "object" in types and not prop.get("description"):
                missing.append((op, name))
    assert missing == []


def test_run_inputs_points_at_describe(ops):
    desc = ops[RUN_OP]["input"]["properties"]["inputs"]["description"]
    assert DESCRIBE_OP in desc
    assert "input_schema" in desc


def test_list_kind_ops_take_page_and_limit(ops):
    for op, e in ops.items():
        if e["kind"] == "list":
            assert {"page", "limit"} <= set(e["input"]["properties"]), op
