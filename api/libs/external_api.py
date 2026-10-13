import pkgutil
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any, ClassVar, Protocol, TypedDict, override

from flask import Blueprint, Flask, current_app, got_request_exception, request
from flask.typing import ResponseReturnValue
from flask_restx import Api
from pydantic import BaseModel
from pydantic.json_schema import SkipJsonSchema
from werkzeug.exceptions import HTTPException, default_exceptions
from werkzeug.http import HTTP_STATUS_CODES

from configs import dify_config
from core.errors.error import AppInvokeQuotaExceededError
from core.plugin.impl.exc import PluginRuntimeError
from extensions.ext_logging import get_request_id
from libs.exception import BaseHTTPException
from libs.flask_restx_compat import install_swagger_compatibility
from libs.token import build_force_logout_cookie_headers


def http_status_message(code):
    return HTTP_STATUS_CODES.get(code, "")


class ErrorResponse(BaseModel):
    """Documented non-2xx body emitted by ``register_external_error_handlers``.

    ``params`` and ``details`` appear only on the errors that set them. The schema
    stays open because ``HTTPException.data`` may carry extra keys.
    """

    code: str
    message: str
    status: int
    params: str | SkipJsonSchema[None] = None
    details: dict[str, Any] | SkipJsonSchema[None] = None


_ERROR_SCHEMA_REF_TEMPLATE = "#/components/schemas/{model}"
ERROR_CODES_VENDOR_KEY = "dify-error-codes"
_ERROR_CODES_EXTENSION = f"x-{ERROR_CODES_VENDOR_KEY}"


class ErrorSpec(TypedDict):
    """How one documented exception reaches the wire, before a surface picks its ``code``."""

    status: int
    # The class's own ``error_code``, if it declares one.
    error_code: str | None
    # The ``code`` the surface's handlers emit when no body formatter rewrites it.
    default_code: str


# What the non-HTTP handlers in register_external_error_handlers emit, as (status, code).
_SHARED_HANDLED_ERRORS: Mapping[type[Exception], tuple[int, str]] = {
    ValueError: (400, "invalid_param"),
    AppInvokeQuotaExceededError: (429, "too_many_requests"),
    PluginRuntimeError: (502, "plugin_runtime_error"),
}


def _class_attribute(cls: type, name: str) -> object:
    """``name`` as the class or its nearest base defines it, without instance or ``__getattr__`` lookups."""
    for klass in cls.__mro__:
        if name in klass.__dict__:
            return klass.__dict__[name]
    return None


def _snake_case(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def _error_spec(exception: type[Exception], handled: Mapping[type[Exception], tuple[int, str]]) -> ErrorSpec:
    declared = _class_attribute(exception, "error_code")
    error_code = str(declared) if isinstance(declared, str) else None
    # Flask-RESTX dispatches to the most specific registered handler, so walk the MRO.
    for base in exception.__mro__:
        if base in handled:
            status, default_code = handled[base]
            return {"status": status, "error_code": error_code, "default_code": default_code}
        if base is HTTPException and issubclass(exception, HTTPException):
            if exception.code is None:
                raise ValueError(f"{exception.__name__} declares no HTTP status")
            if issubclass(exception, BaseHTTPException):
                default_code = exception.error_code
            else:
                default_code = _snake_case(exception.__name__)
            return {"status": exception.code, "error_code": error_code, "default_code": default_code}
    raise ValueError(f"{exception.__name__} has no dedicated error handler; its status and code are not stable")


def is_business_error(exception: type[Exception]) -> bool:
    """Whether ``exception`` names an operation-specific outcome worth listing.

    Werkzeug exceptions and anything dispatched through a dedicated (non-HTTP) handler
    are implied instead: every listed status already admits their codes.
    """
    return issubclass(exception, HTTPException) and not exception.__module__.startswith("werkzeug.")


_HTTP_METHOD_DOC_KEYS = ("get", "put", "post", "delete", "patch", "head", "options", "trace")


def _with_documented_errors(doc: Mapping[str, Any], names: Iterable[str]) -> dict[str, Any]:
    vendor = dict(doc.get("vendor", {}))
    # A dict, not a list: Flask-RESTX deep-merges dicts across decorators and class/method
    # docs but replaces lists, so every contributor's errors survive the merge.
    vendor[ERROR_CODES_VENDOR_KEY] = {**vendor.get(ERROR_CODES_VENDOR_KEY, {}), **dict.fromkeys(names, True)}
    return {**doc, "vendor": vendor}


def _documented_names(exceptions: Iterable[type[Exception]]) -> list[str]:
    exceptions = list(exceptions)
    generic = [exception.__name__ for exception in exceptions if not is_business_error(exception)]
    if generic:
        raise ValueError(f"generic errors are implied, do not list them: {', '.join(generic)}")
    return [f"{exception.__module__}:{exception.__qualname__}" for exception in exceptions]


def document_errors[T](target: T, *exceptions: type[Exception]) -> T:
    """Record the business errors a view or Resource class can raise, for ``error_responses`` docs.

    A view decorator calls this on the wrapper it returns, so every operation it guards
    documents the errors it raises. On a Resource class (for ``method_decorators``) the
    errors apply to each of its operations. Only business errors are accepted; generic
    ones are implied (see ``is_business_error``). Builds new doc dicts because
    ``functools.wraps`` shares the wrapped view's ``__apidoc__``.
    """

    names = _documented_names(exceptions)
    existing = _class_attribute(target, "__apidoc__") if isinstance(target, type) else vars(target).get("__apidoc__")
    doc: Mapping[str, Any] = existing if isinstance(existing, Mapping) else {}
    if isinstance(target, type):
        # Class-level docs only reach operations through their per-method entries.
        doc = {
            **doc,
            **{method: _with_documented_errors(doc.get(method, {}), names) for method in _HTTP_METHOD_DOC_KEYS},
        }
    else:
        doc = _with_documented_errors(doc, names)
    target.__apidoc__ = doc  # type: ignore[attr-defined]
    return target


class ViewDecorator(Protocol):
    """A decorator that returns the view it is given, keeping the view's type."""

    def __call__[F: Callable[..., object]](self, view: F, /) -> F: ...


def error_responses(
    *exceptions: type[Exception],
    unreachable: Sequence[type[Exception]] = (),
) -> ViewDecorator:
    """Document the business errors an operation's handler raises.

    List what the handler and its callees raise; decorators document their own errors
    with ``document_errors``. Each listed status also admits the surface's generic codes,
    and statuses nobody lists keep the surface's open error body. Each surface resolves
    status and ``code`` from its own handlers when it builds the document.

    ``unreachable`` names errors static analysis would infer but that cannot occur (for
    example an ``except`` for a service error the call never raises). They are not
    documented; the entry records the decision.
    """

    _documented_names(exceptions)
    _documented_names(unreachable)

    def decorator[F: Callable[..., object]](view: F, /) -> F:
        return document_errors(view, *exceptions)

    return decorator


def _pascal_case(value: str) -> str:
    return "".join(word[:1].upper() + word[1:] for word in re.split(r"[^0-9A-Za-z]+", value) if word)


def _explicit_json_schema(response: Mapping[str, Any]) -> object | None:
    """The body schema a response already declares, if any."""
    content = response.get("content")
    if not isinstance(content, dict):
        return None
    for media in content.values():
        if isinstance(media, dict) and "schema" in media:
            return media["schema"]
    return None


def attach_error_response_schema(
    document: dict[str, object],
    model: type[BaseModel],
    resolve_error: Callable[[type[Exception]], tuple[int, str]],
    implicit_codes: Callable[[int], set[str]],
) -> dict[str, object]:
    """Give every 4xx/5xx response the surface's error body.

    Statuses documented with ``error_responses`` narrow ``code`` to the listed values plus
    the surface's implicit codes, as a named ``{OperationId}Error{status}`` component.
    A status that also declares its own body schema documents both, as ``anyOf``.
    Other error responses that declare a schema keep it; empty JSON media and responses
    without content get the open error body.
    """

    paths = document.get("paths")
    if not isinstance(paths, dict):
        return document

    ref = {"$ref": _ERROR_SCHEMA_REF_TEMPLATE.format(model=model.__name__)}
    used = False
    narrowed_schemas: dict[str, dict[str, object]] = {}
    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if not isinstance(operation, dict):
                continue
            exception_names: Mapping[str, object] = operation.pop(_ERROR_CODES_EXTENSION, {})
            responses = operation.setdefault("responses", {})
            if not isinstance(responses, dict):
                continue

            codes_by_status: dict[str, set[str]] = {}
            for name in exception_names:
                status_code, code = resolve_error(pkgutil.resolve_name(name))
                codes_by_status.setdefault(str(status_code), set()).add(code)
            for status, codes in codes_by_status.items():
                codes |= implicit_codes(int(status))
                response = responses.setdefault(status, {"description": http_status_message(int(status))})
                operation_id = operation.get("operationId")
                operation_name = operation_id if isinstance(operation_id, str) else f"{method} {path}"
                schema_name = f"{_pascal_case(operation_name)}Error{status}"
                narrowed_schemas[schema_name] = {
                    "allOf": [
                        dict(ref),
                        {
                            "properties": {"code": {"enum": sorted(codes), "type": "string"}},
                            "required": ["code"],
                            "type": "object",
                        },
                    ],
                    "title": schema_name,
                }
                narrowed_ref: dict[str, object] = {"$ref": _ERROR_SCHEMA_REF_TEMPLATE.format(model=schema_name)}
                explicit = _explicit_json_schema(response)
                # A declared body and a documented error can both answer this status.
                schema = narrowed_ref if explicit is None else {"anyOf": [explicit, narrowed_ref]}
                response["content"] = {"application/json": {"schema": schema}}
                used = True

            for status, response in responses.items():
                if status in codes_by_status or not str(status).startswith(("4", "5")):
                    continue
                if not isinstance(response, dict):
                    continue
                content = response.get("content")
                if not isinstance(content, dict) or not content:
                    response["content"] = {"application/json": {"schema": dict(ref)}}
                    used = True
                    continue
                media = content.get("application/json")
                if isinstance(media, dict) and "schema" not in media:
                    media["schema"] = dict(ref)
                    used = True

    if not used:
        return document

    components = document.setdefault("components", {})
    if not isinstance(components, dict):
        return document
    schemas = components.setdefault("schemas", {})
    if not isinstance(schemas, dict):
        return document
    schema = model.model_json_schema(ref_template=_ERROR_SCHEMA_REF_TEMPLATE, mode="serialization")
    definitions = schema.pop("$defs", {})
    for name, definition in {**definitions, model.__name__: schema}.items():
        schemas.setdefault(name, definition)
    for name, definition in narrowed_schemas.items():
        if name in schemas:
            raise ValueError(f"narrowed error schema {name} collides with an existing component")
        schemas[name] = definition
    return document


class ErrorBodyFormatter(Protocol):
    """Last-touch hook over an error body before it goes on the wire."""

    def finalize(self, e: Exception, data: dict[str, Any], status_code: int) -> dict[str, Any]: ...


def register_external_error_handlers(api: Api, body_formatter: ErrorBodyFormatter | None = None):
    def _finalize(e: Exception, data: dict[str, Any], status_code: int) -> dict[str, Any]:
        if body_formatter is None:
            return data
        return body_formatter.finalize(e, data, status_code)

    def handle_http_exception(e: HTTPException):
        got_request_exception.send(current_app, exception=e)

        # If Werkzeug already prepared a Response, just use it. This bypasses
        # body_formatter entirely — surfaces with a formatter must not raise
        # exceptions carrying a pre-built response.
        if e.response is not None:
            return e.response

        status_code = getattr(e, "code", 500) or 500

        # Build a safe, dict-like payload
        default_data = {
            "code": _snake_case(type(e).__name__),
            "message": getattr(e, "description", http_status_message(status_code)),
            "status": status_code,
        }
        if default_data["message"] == "Failed to decode JSON object: Expecting value: line 1 column 1 (char 0)":
            default_data["message"] = "Invalid JSON payload received or JSON payload is empty."

        # Use headers on the exception if present; otherwise none.
        headers = {}
        exc_headers = getattr(e, "headers", None)
        if exc_headers:
            headers.update(exc_headers)

        # Payload per status
        if status_code == 406 and api.default_mediatype is None:
            data = {"code": "not_acceptable", "message": default_data["message"], "status": status_code}
            return _finalize(e, data, status_code), status_code, headers
        elif status_code == 400:
            msg = default_data["message"]
            if isinstance(msg, Mapping) and msg:
                # Convert param errors like {"field": "reason"} into a friendly shape
                param_key, param_value = next(iter(msg.items()))
                data = {
                    "code": "invalid_param",
                    "message": str(param_value),
                    "params": param_key,
                    "status": status_code,
                }
            else:
                data = {**default_data}
                data.setdefault("code", "unknown")
            return _finalize(e, data, status_code), status_code, headers
        else:
            data = {**default_data}
            data.setdefault("code", "unknown")
            # If you need WWW-Authenticate for 401, add it to headers
            if status_code == 401:
                headers["WWW-Authenticate"] = 'Bearer realm="api"'
                # Check if this is a forced logout error - clear cookies
                error_code = getattr(e, "error_code", None)
                if error_code == "unauthorized_and_force_logout":
                    # Add Set-Cookie headers to clear auth cookies
                    headers["Set-Cookie"] = build_force_logout_cookie_headers()
            return _finalize(e, data, status_code), status_code, headers

    def handle_value_error(e: ValueError):
        got_request_exception.send(current_app, exception=e)
        current_app.logger.exception("value_error in request handler")
        status_code = 400
        data = {"code": "invalid_param", "message": str(e), "status": status_code}
        return _finalize(e, data, status_code), status_code

    def handle_quota_exceeded(e: AppInvokeQuotaExceededError):
        got_request_exception.send(current_app, exception=e)
        status_code = 429
        data = {"code": "too_many_requests", "message": str(e), "status": status_code}
        return _finalize(e, data, status_code), status_code

    def handle_plugin_runtime_error(e: PluginRuntimeError):
        got_request_exception.send(current_app, exception=e)
        status_code = 502
        details = {"request_id": get_request_id()}
        if e.lambda_request_id:
            details["lambda_request_id"] = e.lambda_request_id
        data = {
            "code": "plugin_runtime_error",
            "message": e.description,
            "details": details,
            "status": status_code,
        }
        return _finalize(e, data, status_code), status_code

    def handle_general_exception(e: Exception):
        got_request_exception.send(current_app, exception=e)

        status_code = 500
        data: dict[str, Any] = getattr(e, "data", {"message": http_status_message(status_code)})

        # 🔒 Normalize non-mapping data (e.g., if someone set e.data = Response)
        if not isinstance(data, dict):
            data = {"message": str(e)}

        data.setdefault("code", "unknown")
        data.setdefault("status", status_code)

        # Note: Exception logging is handled by Flask/Flask-RESTX framework automatically
        # Explicit log_exception call removed to avoid duplicate log entries

        return _finalize(e, data, status_code), status_code

    api.errorhandler(HTTPException)(handle_http_exception)
    api.errorhandler(ValueError)(handle_value_error)
    api.errorhandler(AppInvokeQuotaExceededError)(handle_quota_exceeded)
    api.errorhandler(PluginRuntimeError)(handle_plugin_runtime_error)
    api.errorhandler(Exception)(handle_general_exception)


class ExternalApi(Api):
    error_response_model: ClassVar[type[BaseModel]] = ErrorResponse
    _authorizations = {
        "Bearer": {
            "bearerFormat": "API_KEY",
            "description": "Use the Service API key as a Bearer token in the Authorization header.",
            "scheme": "bearer",
            "type": "http",
        }
    }

    def __init__(
        self,
        app: Blueprint | Flask,
        *args,
        error_body_formatter: ErrorBodyFormatter | None = None,
        register_default_root: bool = True,
        **kwargs,
    ):
        self._error_body_formatter = error_body_formatter
        self._handled_errors: dict[type[Exception], tuple[int, str]] = dict(_SHARED_HANDLED_ERRORS)
        self._register_default_root = register_default_root
        install_swagger_compatibility()
        kwargs.setdefault("authorizations", self._authorizations)
        kwargs.setdefault("security", "Bearer")
        kwargs["add_specs"] = dify_config.SWAGGER_UI_ENABLED
        kwargs["doc"] = dify_config.SWAGGER_UI_PATH if dify_config.SWAGGER_UI_ENABLED else False
        if error_body_formatter is not None:
            kwargs.setdefault("catch_all_404s", True)
            # the override below patches a private flask-restx method; fail at
            # startup (not at the first 404) if an upgrade removes it
            if not callable(getattr(Api, "_should_use_fr_error_handler", None)):
                raise RuntimeError("flask-restx no longer exposes _should_use_fr_error_handler; update ExternalApi")

        # manual separate call on construction and init_app to ensure configs in kwargs effective
        super().__init__(app=None, *args, **kwargs)
        self.init_app(app, **kwargs)
        register_external_error_handlers(self, body_formatter=error_body_formatter)

    def finish_document(self, document: dict[str, object]) -> dict[str, object]:
        """A surface overrides this to rewrite its finished OpenAPI document (see
        ``DocumentFinisher`` in ``flask_restx_compat``); overrides must call ``super()``.
        The default documents ``error_response_model`` on error responses."""
        return attach_error_response_schema(
            document, self.error_response_model, self.resolve_error, self.implicit_error_codes
        )

    def document_error_handler(self, exception: type[Exception], *, status: int, code: str) -> None:
        """Record what a surface-specific handler for ``exception`` emits, for ``error_responses``."""
        self._handled_errors[exception] = (status, code)

    def resolve_error(self, exception: type[Exception]) -> tuple[int, str]:
        """The (status, ``code``) this surface emits for ``exception``.

        Raises ``ValueError`` when no handler gives it a stable status and code.
        """
        spec = _error_spec(exception, self._handled_errors)
        return spec["status"], self.error_code_for(spec)

    def error_code_for(self, spec: ErrorSpec) -> str:
        """The ``code`` this surface emits for a documented exception."""
        return spec["default_code"]

    def implicit_error_codes(self, status: int) -> set[str]:
        """Generic codes any operation may emit at ``status`` without listing them."""
        codes = set()
        framework_error = default_exceptions.get(status)
        if framework_error is not None:
            codes.add(_snake_case(framework_error.__name__))
        codes.update(code for handled_status, code in self._handled_errors.values() if handled_status == status)
        if status == 500:
            # Unhandled exceptions reach the catch-all handler.
            codes.add("unknown")
        return codes

    @override
    def _register_doc(self, app_or_blueprint: Blueprint | Flask) -> None:
        if self._add_specs and self._doc:
            app_or_blueprint.add_url_rule(self._doc, "doc", self.render_doc)
        # Api.base_path resolves the ``root`` endpoint. A caller that disables
        # Flask-RESTX's 404 root must register its own resource with that endpoint.
        if self._register_default_root:

            def render_default_root() -> ResponseReturnValue:
                self.render_root()
                return "", 404

            app_or_blueprint.add_url_rule(self.prefix or "/", "root", render_default_root)

    @override
    def _should_use_fr_error_handler(self):
        # catch_all_404s makes flask-restx claim NotFound for ANY app path
        # (it wraps the app-level handle_exception), so scope the claim to
        # this blueprint's url prefix; other surfaces keep their own 404s.
        if self._error_body_formatter is not None and not self._request_under_own_prefix():
            return False
        return super()._should_use_fr_error_handler()

    def _request_under_own_prefix(self) -> bool:
        prefix = self.blueprint.url_prefix if self.blueprint is not None else None
        if not prefix:
            return True
        return request.path == prefix or request.path.startswith(prefix.rstrip("/") + "/")
