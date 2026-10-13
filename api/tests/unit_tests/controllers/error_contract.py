"""Check error responses served in controller tests against the API's own OpenAPI document.

Static checks (``dev/lint_error_responses.py``) cannot follow instance calls, signals or
other dynamic dispatch. This catches what they miss on every path a test exercises: each
4xx/5xx JSON response served by an ``ExternalApi`` must carry the standard error body,
and its ``code`` must be one the operation documents for that status.
"""

import sys
from collections.abc import Iterator, Mapping
from typing import cast
from weakref import WeakKeyDictionary, WeakSet

from flask import Flask, Response, current_app, request
from flask_restx.swagger import Swagger, extract_path

from libs.external_api import ExternalApi

STANDARD_KEYS = frozenset({"code", "message", "status"})
_MODULE_APIS = ("controllers.console", "controllers.web", "controllers.service_api", "controllers.openapi")

_created: WeakSet[ExternalApi] = WeakSet()
_documents: WeakKeyDictionary[ExternalApi, dict[str, object]] = WeakKeyDictionary()


def track_external_apis() -> None:
    """Record every ``ExternalApi`` built from now on (module-level surfaces are found by import)."""
    if vars(ExternalApi.__init__).get("_tracked"):
        return
    original = ExternalApi.__init__

    def tracking_init(self: ExternalApi, *args: object, **kwargs: object) -> None:
        original(self, *args, **kwargs)  # type: ignore[arg-type]
        _created.add(self)

    tracking_init._tracked = True  # type: ignore[attr-defined]
    ExternalApi.__init__ = tracking_init  # type: ignore[method-assign]


def _candidate_apis() -> Iterator[ExternalApi]:
    yield from _created
    for name in _MODULE_APIS:
        module = sys.modules.get(name)
        api = vars(module).get("api") if module is not None else None
        if isinstance(api, ExternalApi):
            yield api


def _serving_api(app: Flask) -> ExternalApi | None:
    blueprint = app.blueprints.get(request.blueprint or "")
    if blueprint is None:
        return None
    return next((api for api in _candidate_apis() if api.blueprint is blueprint), None)


def _document(api: ExternalApi) -> dict[str, object]:
    if api not in _documents:
        _documents[api] = cast(dict[str, object], Swagger(api).as_dict())
    return _documents[api]


def _resolve(schema: object, components: Mapping[str, object]) -> Mapping[str, object]:
    if isinstance(schema, Mapping) and isinstance(ref := schema.get("$ref"), str):
        resolved = components.get(ref.rsplit("/", 1)[-1])
        return resolved if isinstance(resolved, Mapping) else {}
    return schema if isinstance(schema, Mapping) else {}


def _documented_codes(schema: Mapping[str, object]) -> set[str] | None:
    """The ``code`` enum a narrowed error component declares, or ``None`` for an open body."""
    parts = schema.get("allOf")
    for part in parts if isinstance(parts, list) else []:
        if isinstance(part, Mapping):
            code = (part.get("properties") or {}).get("code")
            if isinstance(code, Mapping) and isinstance(code.get("enum"), list):
                return {str(value) for value in code["enum"]}
    return None


def _mapping(value: object) -> Mapping[str, object]:
    return cast(Mapping[str, object], value) if isinstance(value, Mapping) else {}


def _is_error_body(schema: Mapping[str, object], error_models: set[str]) -> bool:
    return schema.get("title") in error_models or bool(schema.get("allOf"))


def violation(api: ExternalApi, response: Response) -> str | None:
    """Why ``response`` contradicts the operation's documented error contract, if it does."""
    document = _document(api)
    components = _mapping(_mapping(document.get("components")).get("schemas"))
    rule = request.url_rule
    if rule is None:
        return None
    prefix = (api.blueprint.url_prefix if api.blueprint is not None else "") or ""
    path = extract_path(rule.rule).removeprefix(prefix).removeprefix(api.prefix or "") or "/"
    operation = _mapping(_mapping(document.get("paths")).get(path)).get(request.method.lower())
    if not isinstance(operation, Mapping):
        return None

    where = f"{request.method} {path} -> {response.status_code}"
    body = response.get_json(silent=True)
    if not isinstance(body, dict):
        return f"{where}: error body is not a JSON object: {response.get_data(as_text=True)[:200]!r}"

    declared = (operation.get("responses") or {}).get(str(response.status_code))
    media = ((declared or {}).get("content") or {}).get("application/json") if isinstance(declared, Mapping) else None
    schema = media.get("schema") if isinstance(media, Mapping) else None
    error_models = {api.error_response_model.__name__}
    alternatives = schema.get("anyOf") if isinstance(schema, Mapping) else None
    options = [_resolve(option, components) for option in (alternatives or [schema] if schema is not None else [])]
    error_options = [option for option in options if _is_error_body(option, error_models)]
    if options and not error_options:
        return None  # the status declares its own, non-error model
    if options and len(error_options) < len(options) and not body.keys() >= STANDARD_KEYS:
        return None  # a legacy body the status also declares

    if not body.keys() >= STANDARD_KEYS:
        return f"{where}: error body lacks {sorted(STANDARD_KEYS - body.keys())}: {body!r}"
    if body["status"] != response.status_code:
        return f"{where}: body status {body['status']!r} differs from the HTTP status"
    codes = next((codes for option in error_options if (codes := _documented_codes(option)) is not None), None)
    if codes is not None and body["code"] not in codes:
        return f"{where}: code {body['code']!r} is not documented for this status (documented: {sorted(codes)})"
    return None


def check_response(sender: Flask, response: Response, violations: list[str]) -> None:
    if response.status_code < 400 or not response.is_json:
        return
    api = _serving_api(sender)
    if api is None:
        return
    with current_app.app_context():
        found = violation(api, response)
    if found is not None:
        violations.append(found)
