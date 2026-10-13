"""Check error responses served in controller tests against the API's own OpenAPI document.

Static checks (``dev/lint_error_responses.py``) cannot follow instance calls, signals or
other dynamic dispatch. This catches what they miss on every path a test exercises: each
4xx/5xx JSON response served by an ``ExternalApi`` must carry the standard error body,
and its ``code`` must be one the operation documents for that status or one of the
surface's generic codes (``ExternalApi.implicit_error_codes``). Operations that relay
downstream errors admit any code. On APIs that do not document business errors
(``/openapi/v1``, test-built APIs) only statuses that document a code are checked.
"""

import sys
from collections.abc import Iterator, Mapping
from typing import cast
from weakref import WeakKeyDictionary, WeakSet

from flask import Flask, Response, current_app, request
from flask_restx.swagger import Swagger, extract_path
from jsonschema import Draft202012Validator

from libs.external_api import RELAYS_ERRORS_EXTENSION, ExternalApi

STANDARD_KEYS = frozenset({"code", "message", "status"})
_MODULE_APIS = ("controllers.console", "controllers.web", "controllers.service_api", "controllers.openapi")
# Surfaces whose operations document their business errors (the error lint covers them): a code
# they serve must be documented or generic. Other APIs only have the codes a status documents checked.
_DOCUMENTED_APIS = ("controllers.console", "controllers.web", "controllers.service_api")

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
    yield from _module_apis()


def _serving_api(app: Flask) -> ExternalApi | None:
    """The ExternalApi that routed this request, whether mounted on a blueprint or on the app."""
    blueprint = app.blueprints.get(request.blueprint) if request.blueprint else None
    for api in _candidate_apis():
        if blueprint is not None and api.blueprint is blueprint:
            return api
        if blueprint is None and api.blueprint is None and api.app is app:
            return api
    return None


def _module_apis(names: tuple[str, ...] = _MODULE_APIS) -> Iterator[ExternalApi]:
    for name in names:
        module = sys.modules.get(name)
        api = vars(module).get("api") if module is not None else None
        if isinstance(api, ExternalApi):
            yield api


def _documents_business_errors(api: ExternalApi) -> bool:
    return any(api is surface for surface in _module_apis(_DOCUMENTED_APIS))


def _document(api: ExternalApi) -> dict[str, object]:
    if api not in _documents:
        # Test apps often mount a few resources on a fresh ExternalApi without the namespace
        # that registers their models; borrow those from the real surfaces so the document builds.
        for surface in _module_apis():
            if surface is not api:
                for name, model in surface.models.items():
                    api.models.setdefault(name, model)
        _documents[api] = cast(dict[str, object], Swagger(api).as_dict())
    return _documents[api]


def _resolve(schema: object, components: Mapping[str, object]) -> Mapping[str, object]:
    if isinstance(schema, Mapping) and isinstance(ref := schema.get("$ref"), str):
        resolved = components.get(ref.rsplit("/", 1)[-1])
        return resolved if isinstance(resolved, Mapping) else {}
    return schema if isinstance(schema, Mapping) else {}


def _documented_code(schema: Mapping[str, object]) -> str | None:
    """The fixed ``code`` a per-code error component declares, or ``None`` for the open body."""
    parts = schema.get("allOf")
    for part in parts if isinstance(parts, list) else []:
        if isinstance(part, Mapping):
            code = (part.get("properties") or {}).get("code")
            if isinstance(code, Mapping) and isinstance(code.get("const"), str):
                return code["const"]
    return None


def _mapping(value: object) -> Mapping[str, object]:
    return cast(Mapping[str, object], value) if isinstance(value, Mapping) else {}


def _is_error_body(schema: Mapping[str, object], error_models: set[str]) -> bool:
    return schema.get("title") in error_models or bool(schema.get("allOf"))


def _schema_errors(schema: Mapping[str, object], components: Mapping[str, object], body: object) -> list[str]:
    """How ``body`` fails ``schema``, resolving ``$ref`` against the document's components."""
    validator = Draft202012Validator({**schema, "components": {"schemas": dict(components)}})
    return [
        f"{'/'.join(str(part) for part in error.absolute_path) or 'body'}: {error.message}"
        for error in validator.iter_errors(body)
    ]


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

    responses = _mapping(operation.get("responses"))
    declared = _mapping(responses.get(str(response.status_code)) or responses.get("default"))
    schema = _mapping(_mapping(declared.get("content")).get("application/json")).get("schema")
    error_model = api.error_response_model.__name__
    alternatives = schema.get("anyOf") if isinstance(schema, Mapping) else None
    raw_options = [_mapping(option) for option in (alternatives or ([schema] if schema is not None else []))]
    options = [(option, _resolve(option, components)) for option in raw_options]
    error_options = [raw for raw, resolved in options if _is_error_body(resolved, {error_model})]
    legacy_options = [raw for raw, resolved in options if not _is_error_body(resolved, {error_model})]

    # A body that matches a legacy model the status also declares is documented as is.
    if any(not _schema_errors(option, components, body) for option in legacy_options):
        return None
    if legacy_options and not error_options:
        return f"{where}: error body matches none of the declared models: {body!r}"

    standard = {"$ref": f"#/components/schemas/{error_model}"} if error_model in components else None
    problems: list[str] = _schema_errors(standard, components, body) if standard else []
    if not body.keys() >= STANDARD_KEYS:
        return f"{where}: error body lacks {sorted(STANDARD_KEYS - body.keys())}: {body!r}"
    if problems:
        return f"{where}: error body does not match {error_model} ({'; '.join(problems)}): {body!r}"
    if body["status"] != response.status_code:
        return f"{where}: body status {body['status']!r} differs from the HTTP status"
    documented = {code for option in error_options if (code := _documented_code(_resolve(option, components)))}
    if operation.get(RELAYS_ERRORS_EXTENSION) is True and body["code"] not in documented:
        # The operation relays downstream errors, whose codes the document cannot know.
        return None
    if not documented and not _documents_business_errors(api):
        return None
    generic = api.implicit_error_codes(response.status_code)
    if body["code"] not in documented | generic:
        return (
            f"{where}: code {body['code']!r} is not documented for this status "
            f"(documented: {sorted(documented)}, generic: {sorted(generic)})"
        )
    return None


def check_response(sender: Flask, response: Response, violations: list[str]) -> None:
    if response.status_code < 400 or not response.is_json:
        return
    api = _serving_api(sender)
    if api is None:
        return
    with current_app.app_context():
        try:
            found = violation(api, response)
        except Exception as exc:
            # The checker never changes the response under test, but a response it cannot check
            # (e.g. a test app missing a model the document needs) must not pass silently.
            found = (
                f"{request.method} {request.path} -> {response.status_code}: cannot check the error contract: {exc!r}"
            )
    if found is not None:
        violations.append(found)
