"""The catalog: one JSON document describing every op on ``/openapi/v1``.

Built once per Flask app from the url map plus the ``EndpointSpec`` each guarded view
carries as ``__spec__``: the flat input schema (path + query + body, ``$ref``s inlined)
and the ``bind`` table are derived here and nowhere else. Frozen to canonical bytes,
fingerprinted with sha256, served at ``GET /openapi/v1/_catalog``, and the fingerprint
rides on every response in ``X-Dify-Catalog`` so a client can tell its cached copy is
stale without an extra round trip.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Collection, Mapping, Sequence
from enum import StrEnum
from typing import Any, Final

from flask import Blueprint, Flask, Response, current_app, request
from pydantic import BaseModel

from configs import dify_config
from controllers.openapi.auth.spec import EndpointSpec

CATALOG_HEADER: Final = "X-Dify-Catalog"
# Trailing slash: `/openapi/v1beta/x` is a different surface, not this one.
_PREFIX: Final = "/openapi/v1/"
CATALOG_PATH: Final = f"{_PREFIX}_catalog"
_VERBS: Final = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE"})
_EXT_KEY: Final = "openapi_catalog"
_PLACEHOLDER_RE: Final = re.compile(r"<(?:\w+:)?(\w+)>")
_TEMPLATE_RE: Final = re.compile(r"\{(\w+)\}")
_DEFS: Final = "$defs"
_REF: Final = "$ref"
_REF_PREFIX: Final = "#/$defs/"
_QUERY_METHODS: Final = frozenset({"GET", "DELETE"})


class Bind(StrEnum):
    PATH = "path"
    QUERY = "query"
    BODY = "body"
    FILE = "file"


def inline_refs(schema: Mapping[str, Any]) -> dict[str, Any]:
    defs = schema.get(_DEFS) or {}

    def walk(node: Any, stack: tuple[str, ...]) -> Any:
        if isinstance(node, list):
            return [walk(item, stack) for item in node]
        if not isinstance(node, Mapping):
            return node
        ref = node.get(_REF)
        if isinstance(ref, str) and ref.startswith(_REF_PREFIX):
            name = ref[len(_REF_PREFIX) :]
            if name in stack:
                raise ValueError(f"recursive $ref {name} cannot be inlined")
            target = walk(defs[name], (*stack, name))
            rest = {k: v for k, v in node.items() if k != _REF}
            return {**target, **walk(rest, stack)}
        return {k: walk(v, stack) for k, v in node.items() if k != _DEFS}

    return walk(schema, ())


def _model_properties(model: type[BaseModel] | None) -> tuple[dict[str, Any], list[str]]:
    if model is None:
        return {}, []
    flat = inline_refs(model.model_json_schema(mode="validation"))
    return dict(flat.get("properties", {})), list(flat.get("required", []))


def op_input_schema(
    *, path_params: Sequence[str], query: type[BaseModel] | None, body: type[BaseModel] | None
) -> dict[str, Any]:
    properties: dict[str, Any] = {name: {"type": "string"} for name in path_params}
    required: list[str] = list(path_params)
    for model in (query, body):
        props, req = _model_properties(model)
        clash = set(props) & set(properties)
        if clash:
            raise ValueError(f"parameter name clash across path/query/body: {sorted(clash)}")
        properties.update(copy.deepcopy(props))
        required.extend(req)
    return {"type": "object", "properties": properties, "required": required}


def _has_binary_leaf(node: Any) -> bool:
    if isinstance(node, list):
        return any(_has_binary_leaf(item) for item in node)
    if not isinstance(node, Mapping):
        return False
    if node.get("type") == "string" and node.get("format") == "binary":
        return True
    return any(_has_binary_leaf(value) for value in node.values())


def derive_bind(*, method: str, path_params: Sequence[str], schema: Mapping[str, Any]) -> dict[str, Bind]:
    default = Bind.QUERY if method.upper() in _QUERY_METHODS else Bind.BODY
    bind: dict[str, Bind] = {}
    for name, prop in schema.get("properties", {}).items():
        if name in path_params:
            bind[name] = Bind.PATH
        elif _has_binary_leaf(prop):
            bind[name] = Bind.FILE
        else:
            bind[name] = default
    return bind


def _catalog_path(rule: str, *, arguments: Collection[str]) -> str:
    """Werkzeug converters this substitution does not understand (``<int(min=1):n>``)
    would otherwise leave their raw syntax in the published path.
    """
    path = _PLACEHOLDER_RE.sub(r"{\1}", rule)
    if set(_TEMPLATE_RE.findall(path)) != set(arguments):
        raise ValueError(f"path placeholders of {rule} do not resolve to its arguments")
    return path


def _spec_of(view: Any) -> EndpointSpec | None:
    spec = getattr(view, "__spec__", None)
    return spec if isinstance(spec, EndpointSpec) else None


def build_catalog(app: Flask) -> dict[str, Any]:
    ops: dict[str, Any] = {}
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith(_PREFIX):
            continue
        cls = getattr(app.view_functions.get(rule.endpoint), "view_class", None)
        if cls is None:
            continue
        for verb in sorted((rule.methods or set()) & _VERBS):
            spec = _spec_of(getattr(cls, verb.lower(), None))
            if spec is None or not spec.allows(dify_config.DEPLOYMENT_EDITION):
                continue
            path_params = sorted(rule.arguments)
            schema = op_input_schema(path_params=path_params, query=spec.query, body=spec.body)
            if spec.op in ops:
                raise RuntimeError(f"op id {spec.op} declared on two routes")
            ops[spec.op] = {
                "summary": spec.summary,
                "method": verb,
                "path": _catalog_path(rule.rule, arguments=rule.arguments),
                "kind": spec.kind.value,
                "input": schema,
                "bind": derive_bind(method=verb, path_params=path_params, schema=schema),
                "tags": [spec.op.split(".", 1)[0]],
                "internal": spec.internal,
                "deprecated": spec.deprecated,
            }
    return {"ops": ops}


def catalog_for(app: Flask) -> tuple[bytes, str]:
    cached = app.extensions.get(_EXT_KEY)
    if cached is None:
        raw = json.dumps(build_catalog(app), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        cached = app.extensions[_EXT_KEY] = (raw, hashlib.sha256(raw).hexdigest())
    return cached


def catalog_response() -> Response:
    raw, _ = catalog_for(current_app._get_current_object())  # type: ignore[attr-defined]
    return Response(raw, status=200, mimetype="application/json")


def attach_catalog(bp: Blueprint) -> None:
    @bp.after_app_request
    def _stamp_fingerprint(response: Response) -> Response:  # pyright: ignore[reportUnusedFunction]
        if request.path.startswith(_PREFIX):
            _, fingerprint = catalog_for(current_app._get_current_object())  # type: ignore[attr-defined]
            response.headers[CATALOG_HEADER] = fingerprint
        return response
