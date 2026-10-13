import pkgutil
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, ClassVar, Protocol, TypedDict, override

from flask import Blueprint, Flask, current_app, got_request_exception, request
from flask.typing import ResponseReturnValue
from flask_restx import Api
from pydantic import BaseModel
from pydantic.json_schema import SkipJsonSchema
from werkzeug.exceptions import HTTPException
from werkzeug.http import HTTP_STATUS_CODES

from configs import dify_config
from core.errors.error import AppInvokeQuotaExceededError
from core.plugin.impl.exc import PluginRuntimeError
from extensions.ext_logging import get_request_id
from libs.exception import BaseHTTPException, RelayedHTTPError
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
# ``BaseHTTPException`` ships this placeholder; a documented business error must replace it.
_UNDECLARED_ERROR_CODE = BaseHTTPException.error_code


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


def _framework_error_codes() -> dict[int, set[str]]:
    """The codes Werkzeug's own HTTP exceptions produce, by status.

    The HTTP handler names the code after the raised class, so subclasses such as
    ``BadRequestKeyError`` (a missing form or file field) answer with their own code.
    """
    by_status: dict[int, set[str]] = {}
    pending: list[type[HTTPException]] = [HTTPException]
    while pending:
        exception = pending.pop()
        pending.extend(exception.__subclasses__())
        if exception.__module__.startswith("werkzeug.") and isinstance(exception.code, int) and exception.code >= 400:
            by_status.setdefault(exception.code, set()).add(_snake_case(exception.__name__))
    return by_status


def _error_spec(
    exception: type[Exception],
    handled: Mapping[type[Exception], tuple[int, str]],
    dispatch_order: Iterable[type[BaseException]],
) -> ErrorSpec:
    declared = _class_attribute(exception, "error_code")
    error_code = str(declared) if isinstance(declared, str) else None
    # Flask-RESTX dispatches to the first registered handler whose type matches, in
    # registration order (not the most specific one), so resolve the same way.
    for handler_type in dispatch_order:
        if not issubclass(exception, handler_type):
            continue
        if handler_type in handled:
            status, default_code = handled[handler_type]
            return {"status": status, "error_code": error_code, "default_code": default_code}
        if handler_type is HTTPException and issubclass(exception, HTTPException):
            if exception.code is None:
                raise ValueError(f"{exception.__name__} declares no HTTP status")
            if issubclass(exception, BaseHTTPException):
                default_code = exception.error_code
            else:
                default_code = _snake_case(exception.__name__)
            return {"status": exception.code, "error_code": error_code, "default_code": default_code}
        break
    raise ValueError(f"{exception.__name__} has no dedicated error handler; its status and code are not stable")


def is_business_error(exception: type[Exception]) -> bool:
    """Whether ``exception`` names an operation-specific outcome worth listing.

    Werkzeug exceptions and anything dispatched through a dedicated (non-HTTP) handler
    are generic instead: clients handle them centrally, and every operation's open
    ``default`` error response covers them.
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
    undeclared = [
        exception.__name__
        for exception in exceptions
        if issubclass(exception, BaseHTTPException)
        and not issubclass(exception, RelayedHTTPError)
        and _class_attribute(exception, "error_code") == _UNDECLARED_ERROR_CODE
    ]
    if undeclared:
        raise ValueError(f"business errors must declare an error_code: {', '.join(undeclared)}")
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
    with ``document_errors``. Generic errors are never listed: every operation documents
    an open ``default`` error for them. Each surface resolves status and ``code`` from its
    own handlers when it builds the document, and documents each code once as a shared
    ``{Code}Error`` component, so a business error must declare an ``error_code``.

    ``unreachable`` names errors ``dev/lint_error_responses.py`` infers but that cannot
    occur (for example an ``except`` for a service error the call never raises). They are
    not documented; the entry records the decision so the linter does not re-add them.
    """

    _documented_names(exceptions)
    _documented_names(unreachable)

    def decorator[F: Callable[..., object]](view: F, /) -> F:
        return document_errors(view, *exceptions)

    return decorator


def _pascal_case(value: str) -> str:
    return "".join(word[:1].upper() + word[1:] for word in re.split(r"[^0-9A-Za-z]+", value) if word)


def error_component_name(code: str) -> str:
    """The component that documents ``code``: ``draft_workflow_not_sync`` becomes ``DraftWorkflowNotSyncError``."""
    name = _pascal_case(code)
    return name if name.endswith("Error") else f"{name}Error"


def _details_model(exception: type[Exception]) -> type[BaseModel] | None:
    """The Pydantic model an exception declares for its ``details``, if any."""
    model = _class_attribute(exception, "details_model")
    return model if isinstance(model, type) and issubclass(model, BaseModel) else None


@dataclass(frozen=True)
class _ErrorComponent:
    code: str
    status: int
    exception: type[Exception]
    details_model: type[BaseModel] | None
    where: str

    def schema(self, name: str, error_body_ref: Mapping[str, object]) -> dict[str, object]:
        properties: dict[str, object] = {
            "code": {"const": self.code, "type": "string"},
            "status": {"const": self.status, "type": "integer"},
        }
        if self.details_model is not None:
            properties["details"] = {"$ref": _ERROR_SCHEMA_REF_TEMPLATE.format(model=self.details_model.__name__)}
        schema: dict[str, object] = {
            "allOf": [dict(error_body_ref), {"properties": properties, "required": ["code"], "type": "object"}],
            "title": name,
        }
        description = _class_attribute(self.exception, "description")
        if isinstance(description, str) and description:
            schema["description"] = description
        return schema


def _explicit_json_schema(response: Mapping[str, Any]) -> object | None:
    """The body schema a response already declares, if any."""
    content = response.get("content")
    if not isinstance(content, dict):
        return None
    for media in content.values():
        if isinstance(media, dict) and "schema" in media:
            return media["schema"]
    return None


def _add_model_schemas(schemas: dict[str, object], model: type[BaseModel]) -> None:
    schema = model.model_json_schema(ref_template=_ERROR_SCHEMA_REF_TEMPLATE, mode="serialization")
    definitions = schema.pop("$defs", {})
    for name, definition in {**definitions, model.__name__: schema}.items():
        schemas.setdefault(name, definition)


def attach_error_response_schema(
    document: dict[str, object],
    model: type[BaseModel],
    resolve_error: Callable[[type[Exception]], tuple[int, str]],
) -> dict[str, object]:
    """Give every 4xx/5xx response the surface's error body and document business errors by code.

    Every operation gets a ``default`` error response with the open error body: generic
    errors (authentication, validation, rate limits, unexpected failures) can answer any
    operation and clients handle them centrally, so no operation lists them.

    Each business error an operation documents with ``error_responses`` is one shared
    ``{Code}Error`` component: the error body with ``code`` and ``status`` fixed, plus the
    class's ``details_model`` when it declares one. The response of its status references
    it; several codes on one status are an ``anyOf``, and a status that also declares its
    own body schema keeps that schema beside them. A code maps to exactly one status in a
    document, and two classes may share a code only when they agree on it. A documented
    ``RelayedHTTPError`` adds nothing: its status and code are only known at runtime.
    """

    paths = document.get("paths")
    if not isinstance(paths, dict):
        return document

    ref: dict[str, object] = {"$ref": _ERROR_SCHEMA_REF_TEMPLATE.format(model=model.__name__)}
    error_components: dict[str, _ErrorComponent] = {}
    used = False
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
            where = f"{method.upper()} {path}"

            components_by_status: dict[str, set[str]] = {}
            for exception_name in exception_names:
                exception = pkgutil.resolve_name(exception_name)
                if issubclass(exception, RelayedHTTPError):
                    # Its status and code come from a downstream service at runtime; the open
                    # ``default`` error already documents it.
                    continue
                status, code = resolve_error(exception)
                name = error_component_name(code)
                component = _ErrorComponent(code, status, exception, _details_model(exception), where)
                known = error_components.setdefault(name, component)
                if known.code != code:
                    raise ValueError(
                        f"error codes {known.code!r} ({known.where}) and {code!r} ({where}) both document as {name}"
                    )
                if known.status != status:
                    raise ValueError(
                        f"error code {code!r} answers {status} on {where} but {known.status} on {known.where}; "
                        "a code maps to one status"
                    )
                if known.details_model is not component.details_model:
                    raise ValueError(
                        f"error code {code!r} declares different details models on {known.where} and {where}"
                    )
                components_by_status.setdefault(str(status), set()).add(name)

            for status, names in components_by_status.items():
                response = responses.setdefault(status, {"description": http_status_message(int(status))})
                if not isinstance(response, dict):
                    continue
                options: list[object] = [
                    {"$ref": _ERROR_SCHEMA_REF_TEMPLATE.format(model=name)} for name in sorted(names)
                ]
                explicit = _explicit_json_schema(response)
                if explicit is not None:
                    # The declared body and the documented errors can all answer this status.
                    options.insert(0, explicit)
                response["content"] = {
                    "application/json": {"schema": options[0] if len(options) == 1 else {"anyOf": options}}
                }
                used = True

            responses.setdefault("default", {"description": "Error"})
            for status, response in responses.items():
                if status in components_by_status or not (status == "default" or str(status).startswith(("4", "5"))):
                    continue
                if not isinstance(response, dict):
                    continue
                content = response.get("content")
                if not isinstance(content, dict) or not content:
                    response["content"] = {"application/json": {"schema": dict(ref)}}
                    used = True
                    continue
                media = content.get("application/json")
                if not isinstance(media, dict):
                    continue
                declared = media.get("schema")
                if declared is None:
                    media["schema"] = dict(ref)
                    used = True
                elif declared != ref:
                    # A declared body never replaces the error body: the surface's handlers can
                    # still answer this status with it (validation, auth, unexpected errors).
                    media["schema"] = {"anyOf": [declared, dict(ref)]}
                    used = True

    if not used:
        return document

    components = document.setdefault("components", {})
    if not isinstance(components, dict):
        return document
    schemas = components.setdefault("schemas", {})
    if not isinstance(schemas, dict):
        return document
    _add_model_schemas(schemas, model)
    for name, component in error_components.items():
        if component.details_model is not None:
            _add_model_schemas(schemas, component.details_model)
        if name in schemas:
            raise ValueError(f"error component {name} (code {component.code!r}) collides with an existing component")
        schemas[name] = component.schema(name, ref)
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
        return attach_error_response_schema(document, self.error_response_model, self.resolve_error)

    def document_error_handler(self, exception: type[Exception], *, status: int, code: str) -> None:
        """Record what a surface-specific handler for ``exception`` emits, for ``error_responses``."""
        self._handled_errors[exception] = (status, code)

    def resolve_error(self, exception: type[Exception]) -> tuple[int, str]:
        """The (status, ``code``) this surface emits for ``exception``.

        Raises ``ValueError`` when no handler gives it a stable status and code.
        """
        spec = _error_spec(exception, self._handled_errors, self._error_dispatch_order())
        return spec["status"], self.error_code_for(spec)

    def _error_dispatch_order(self) -> list[type[BaseException]]:
        """Handler types in the order Flask-RESTX tries them: the API's own, then new namespace ones."""
        order: list[type[BaseException]] = list(self.error_handlers)
        for namespace in self.namespaces:
            order.extend(exception for exception in namespace.error_handlers if exception not in order)
        return order

    def error_code_for(self, spec: ErrorSpec) -> str:
        """The ``code`` this surface emits for a documented exception."""
        return spec["default_code"]

    def implicit_error_codes(self, status: int) -> set[str]:
        """Generic codes any operation may emit at ``status`` without listing them.

        The document covers them with each operation's open ``default`` error; checks that
        compare served error bodies with the document admit them beside the documented
        business codes.
        """
        codes = set(_framework_error_codes().get(status, ()))
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
