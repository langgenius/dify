from collections.abc import Callable
from functools import wraps

import pytest
from flask import Blueprint, Flask
from flask_restx import Api, Namespace, Resource
from flask_restx.swagger import Swagger
from pydantic import BaseModel
from werkzeug.exceptions import BadRequest, NotFound, Unauthorized

from constants import COOKIE_NAME_ACCESS_TOKEN, COOKIE_NAME_CSRF_TOKEN, COOKIE_NAME_REFRESH_TOKEN
from core.errors.error import AppInvokeQuotaExceededError
from core.plugin.impl.exc import PluginRuntimeError
from libs.exception import BaseHTTPException
from libs.external_api import (
    ERROR_CODES_VENDOR_KEY,
    ErrorResponse,
    ExternalApi,
    attach_error_response_schema,
    document_errors,
    error_responses,
    keeps_placeholder_error_code,
)
from libs.rate_limit import _BearerRateLimited


def _create_api_app():
    app = Flask(__name__)
    bp = Blueprint("t", __name__)
    api = ExternalApi(bp)

    @api.route("/bad-request")
    class Bad(Resource):
        def get(self):
            raise BadRequest("invalid input")

    @api.route("/unauth")
    class Unauth(Resource):
        def get(self):
            raise Unauthorized("auth required")

    @api.route("/value-error")
    class ValErr(Resource):
        def get(self):
            raise ValueError("boom")

    @api.route("/quota")
    class Quota(Resource):
        def get(self):
            raise AppInvokeQuotaExceededError("quota exceeded")

    @api.route("/general")
    class Gen(Resource):
        def get(self):
            raise RuntimeError("oops")

    @api.route("/plugin-runtime-error")
    class PluginRuntime(Resource):
        def get(self):
            raise PluginRuntimeError(
                "Plugin runtime request failed: Runtime.ExitError: Runtime exited with error: exit status 1",
                lambda_request_id="lambda-request-id",
            )

    # Note: We avoid altering default_mediatype to keep normal error paths

    # Special 400 message rewrite
    @api.route("/json-empty")
    class JsonEmpty(Resource):
        def get(self):
            e = BadRequest()
            # Force the specific message the handler rewrites
            e.description = "Failed to decode JSON object: Expecting value: line 1 column 1 (char 0)"
            raise e

    # 400 mapping payload path
    @api.route("/param-errors")
    class ParamErrors(Resource):
        def get(self):
            e = BadRequest()
            # Coerce a mapping description to trigger param error shaping
            e.description = {"field": "is required"}
            raise e

    # The per-token rate limit raises this; ExternalApi must carry its Retry-After header to the
    # wire (it reads getattr(e, "headers"), not werkzeug's get_headers()).
    @api.route("/rate-limited")
    class RateLimited(Resource):
        def get(self):
            raise _BearerRateLimited(23)

    app.register_blueprint(bp, url_prefix="/api")
    return app


def test_external_api_error_handlers_basic_paths():
    app = _create_api_app()
    client = app.test_client()

    # 400
    res = client.get("/api/bad-request")
    assert res.status_code == 400
    data = res.get_json()
    assert data["code"] == "bad_request"
    assert data["status"] == 400

    # 401
    res = client.get("/api/unauth")
    assert res.status_code == 401
    assert "WWW-Authenticate" in res.headers

    # 400 ValueError
    res = client.get("/api/value-error")
    assert res.status_code == 400
    assert res.get_json()["code"] == "invalid_param"

    # 500 general
    res = client.get("/api/general")
    assert res.status_code == 500
    assert res.get_json()["status"] == 500


def test_external_api_json_message_and_bad_request_rewrite():
    app = _create_api_app()
    client = app.test_client()

    # JSON empty special rewrite
    res = client.get("/api/json-empty")
    assert res.status_code == 400
    assert res.get_json()["message"] == "Invalid JSON payload received or JSON payload is empty."


def test_external_api_plugin_runtime_error(mocker):
    mocker.patch("libs.external_api.get_request_id", return_value="api-request-id")
    app = _create_api_app()

    res = app.test_client().get("/api/plugin-runtime-error")

    assert res.status_code == 502
    assert res.get_json() == {
        "code": "plugin_runtime_error",
        "message": "Plugin runtime request failed: Runtime.ExitError: Runtime exited with error: exit status 1",
        "details": {
            "request_id": "api-request-id",
            "lambda_request_id": "lambda-request-id",
        },
        "status": 502,
    }


def test_external_api_param_mapping_and_quota():
    app = _create_api_app()
    client = app.test_client()

    # Param errors mapping payload path
    res = client.get("/api/param-errors")
    assert res.status_code == 400
    data = res.get_json()
    assert data["code"] == "invalid_param"
    assert data["params"] == "field"

    # Quota path — depending on Flask-RESTX internals it may be handled
    res = client.get("/api/quota")
    assert res.status_code in (400, 429)


def test_external_api_carries_exception_headers_to_429_response():
    # Locks the coupling enforce_bearer_rate_limit relies on: handle_error reads getattr(e,
    # "headers") and puts it on the response, so Retry-After reaches the wire.
    app = _create_api_app()
    res = app.test_client().get("/api/rate-limited")
    assert res.status_code == 429
    assert res.headers["Retry-After"] == "23"
    assert (res.get_json() or {})["status"] == 429


def test_unauthorized_and_force_logout_clears_cookies():
    """Test that UnauthorizedAndForceLogout error clears auth cookies"""

    class UnauthorizedAndForceLogout(BaseHTTPException):
        error_code = "unauthorized_and_force_logout"
        description = "Unauthorized and force logout."
        code = 401

    app = Flask(__name__)
    bp = Blueprint("test", __name__)
    api = ExternalApi(bp)

    @api.route("/force-logout")
    class ForceLogout(Resource):  # type: ignore
        def get(self):  # type: ignore
            raise UnauthorizedAndForceLogout()

    app.register_blueprint(bp, url_prefix="/api")
    client = app.test_client()

    # Set cookies first
    client.set_cookie(COOKIE_NAME_ACCESS_TOKEN, "test_access_token")
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, "test_csrf_token")
    client.set_cookie(COOKIE_NAME_REFRESH_TOKEN, "test_refresh_token")

    # Make request that should trigger cookie clearing
    res = client.get("/api/force-logout")

    # Verify response
    assert res.status_code == 401
    data = res.get_json()
    assert data["code"] == "unauthorized_and_force_logout"
    assert data["status"] == 401
    assert "WWW-Authenticate" in res.headers

    # Verify Set-Cookie headers are present to clear cookies
    set_cookie_headers = res.headers.getlist("Set-Cookie")
    assert len(set_cookie_headers) == 3, f"Expected 3 Set-Cookie headers, got {len(set_cookie_headers)}"

    # Verify each cookie is being cleared (empty value and expired)
    cookie_names_found = set()
    for cookie_header in set_cookie_headers:
        # Check for cookie names
        if COOKIE_NAME_ACCESS_TOKEN in cookie_header:
            cookie_names_found.add(COOKIE_NAME_ACCESS_TOKEN)
            assert '""' in cookie_header or "=" in cookie_header  # Empty value
            assert "Expires=Thu, 01 Jan 1970" in cookie_header  # Expired
        elif COOKIE_NAME_CSRF_TOKEN in cookie_header:
            cookie_names_found.add(COOKIE_NAME_CSRF_TOKEN)
            assert '""' in cookie_header or "=" in cookie_header
            assert "Expires=Thu, 01 Jan 1970" in cookie_header
        elif COOKIE_NAME_REFRESH_TOKEN in cookie_header:
            cookie_names_found.add(COOKIE_NAME_REFRESH_TOKEN)
            assert '""' in cookie_header or "=" in cookie_header
            assert "Expires=Thu, 01 Jan 1970" in cookie_header

    # Verify all three cookies are present
    assert len(cookie_names_found) == 3
    assert COOKIE_NAME_ACCESS_TOKEN in cookie_names_found
    assert COOKIE_NAME_CSRF_TOKEN in cookie_names_found
    assert COOKIE_NAME_REFRESH_TOKEN in cookie_names_found


class _PassthroughFormatter:
    def finalize(self, _e: Exception, data: dict[str, object], _status_code: int) -> dict[str, object]:
        return data


def test_missing_flask_restx_private_hook_fails_at_startup(monkeypatch: pytest.MonkeyPatch):
    """The guard exists so a flask-restx upgrade breaks construction, not the first 404."""
    monkeypatch.delattr(Api, "_should_use_fr_error_handler")

    with pytest.raises(RuntimeError, match="_should_use_fr_error_handler"):
        ExternalApi(Blueprint("guard", __name__), error_body_formatter=_PassthroughFormatter())


def _unused_resolver(exception: type[Exception]) -> tuple[int, str]:
    raise AssertionError(f"no documented exceptions expected, got {exception}")


_ERROR_BODY_REF = {"$ref": "#/components/schemas/ErrorResponse"}


def test_attach_error_response_schema_documents_the_error_body_on_every_error_status():
    explicit = {"application/json": {"schema": {"$ref": "#/components/schemas/Custom"}}}
    document: dict[str, object] = {
        "paths": {
            "/items": {
                "get": {
                    "responses": {
                        "200": {"description": "OK"},
                        "302": {"description": "Redirect"},
                        "400": {"description": "Bad", "content": {"application/json": {}}},
                        "404": {"description": "Missing"},
                        "409": {"description": "Conflict", "content": explicit},
                    }
                }
            }
        }
    }

    attach_error_response_schema(document, ErrorResponse, _unused_resolver)

    responses = document["paths"]["/items"]["get"]["responses"]  # type: ignore[index]
    assert responses["400"]["content"] == {"application/json": {"schema": _ERROR_BODY_REF}}
    assert responses["404"]["content"] == {"application/json": {"schema": _ERROR_BODY_REF}}
    # A declared body never replaces the error body the handlers can still send.
    assert responses["409"]["content"] == {
        "application/json": {"schema": {"anyOf": [{"$ref": "#/components/schemas/Custom"}, _ERROR_BODY_REF]}}
    }
    # Generic errors can answer any operation, so every operation documents an open default.
    assert responses["default"] == {
        "description": "Error",
        "content": {"application/json": {"schema": _ERROR_BODY_REF}},
    }
    assert "content" not in responses["200"]
    assert "content" not in responses["302"]
    schema = document["components"]["schemas"]["ErrorResponse"]  # type: ignore[index]
    assert schema["required"] == ["code", "message", "status"]


def test_attach_error_response_schema_leaves_documents_without_paths_alone():
    document: dict[str, object] = {"info": {"title": "empty"}}

    attach_error_response_schema(document, ErrorResponse, _unused_resolver)

    assert document == {"info": {"title": "empty"}}


class _DocumentedError(BaseHTTPException):
    error_code = "documented_error"
    code = 400


class _ItemMissingError(BaseHTTPException):
    error_code = "item_missing"
    description = "Item is missing."
    code = 404


class _WrapperDeniedError(BaseHTTPException):
    error_code = "wrapper_denied"
    code = 401


class _GuardDeniedError(BaseHTTPException):
    error_code = "guard_denied"
    code = 403


class _ConflictDetails(BaseModel):
    server_hash: str


class _ConflictError(BaseHTTPException):
    error_code = "documented_conflict"
    code = 409
    details_model = _ConflictDetails


def _guarded[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        return view(*args, **kwargs)

    return document_errors(decorated, _WrapperDeniedError)


def _documented_operation(api: ExternalApi, *exceptions: type[Exception]) -> dict:
    app = Flask(__name__)
    ns = Namespace("documented", path="/")

    class GuardedResource(Resource):
        pass

    document_errors(GuardedResource, _GuardDeniedError)

    @ns.route("/documented")
    class Documented(GuardedResource):
        @ns.doc("get_documented")
        @ns.response(404, "Item missing")
        @error_responses(*exceptions)
        @_guarded
        def get(self):
            return {}

    api.add_namespace(ns)
    app.register_blueprint(api.blueprint)
    with app.test_request_context("/"):
        return Swagger(api).as_dict()


def _responses(document: dict) -> dict:
    return document["paths"]["/documented"]["get"]["responses"]


def _error_options(document: dict, status: str, body_ref: dict[str, str] = _ERROR_BODY_REF) -> list[str]:
    """The component names a status documents, in order, before the open error body that ends them."""
    schema = _responses(document)[status]["content"]["application/json"]["schema"]
    options = schema.get("anyOf", [schema])
    # A generic error can answer any documented status, so the open body is always the last option.
    assert options[-1] == body_ref
    return [option["$ref"].rsplit("/", 1)[-1] for option in options[:-1]]


def _documented_names_for(*exceptions: type[Exception]) -> dict[str, bool]:
    return {f"{exception.__module__}:{exception.__qualname__}": True for exception in exceptions}


def _resolve_by_class(exception: type[Exception]) -> tuple[int, str]:
    assert issubclass(exception, BaseHTTPException)
    assert exception.code is not None
    return exception.code, exception.error_code


def test_document_errors_keeps_hidden_views_and_methods_hidden():
    class Partly(Resource):
        __apidoc__ = {"get": False, "post": {"description": "create"}}

    document_errors(Partly, _GuardDeniedError)

    assert Partly.__apidoc__["get"] is False
    assert Partly.__apidoc__["post"]["description"] == "create"
    assert Partly.__apidoc__["post"]["vendor"][ERROR_CODES_VENDOR_KEY] == _documented_names_for(_GuardDeniedError)
    assert Partly.__apidoc__["delete"]["vendor"][ERROR_CODES_VENDOR_KEY] == _documented_names_for(_GuardDeniedError)

    class Hidden(Resource):
        __apidoc__ = False

    def hidden_view():
        return {}

    hidden_view.__apidoc__ = False  # type: ignore[attr-defined]

    assert document_errors(Hidden, _GuardDeniedError).__apidoc__ is False
    assert document_errors(hidden_view, _GuardDeniedError).__apidoc__ is False  # type: ignore[attr-defined]


def test_error_responses_document_handler_wrapper_and_class_errors_by_code():
    document = _documented_operation(
        ExternalApi(Blueprint("documented", __name__)), _DocumentedError, _ItemMissingError
    )

    assert _error_options(document, "400") == ["DocumentedError"]
    assert _error_options(document, "404") == ["ItemMissingError"]
    assert _responses(document)["404"]["description"] == "Item missing"
    assert _error_options(document, "401") == ["WrapperDeniedError"]
    assert _responses(document)["401"]["description"] == "Unauthorized"
    assert _error_options(document, "403") == ["GuardDeniedError"]
    # Generic codes (validation, framework errors) are not listed; the open default covers them.
    assert _responses(document)["default"]["content"] == {"application/json": {"schema": _ERROR_BODY_REF}}
    assert document["components"]["schemas"]["ItemMissingError"] == {
        "allOf": [
            _ERROR_BODY_REF,
            {
                "properties": {
                    "code": {"const": "item_missing", "type": "string"},
                    "status": {"const": 404, "type": "integer"},
                },
                "required": ["code", "status"],
                "type": "object",
            },
        ],
        "description": "Item is missing.",
        "title": "ItemMissingError",
    }


def test_openapi_surface_resolves_codes_like_its_formatter():
    from controllers.openapi import _OpenApi
    from controllers.openapi._errors import OpenApiErrorFormatter

    document = _documented_operation(
        _OpenApi(Blueprint("documented_openapi", __name__), error_body_formatter=OpenApiErrorFormatter()),
        _DocumentedError,
    )

    body_ref = {"$ref": "#/components/schemas/ErrorBody"}
    assert _error_options(document, "400", body_ref) == ["DocumentedError"]
    component = document["components"]["schemas"]["DocumentedError"]
    assert component["allOf"][0] == body_ref
    assert component["allOf"][1]["properties"]["code"] == {"const": "documented_error", "type": "string"}


@pytest.mark.parametrize("exception", [ValueError, NotFound, Unauthorized])
def test_error_responses_rejects_generic_errors(exception: type[Exception]):
    with pytest.raises(ValueError, match="generic errors are implied"):
        error_responses(exception)


def test_error_responses_requires_an_error_code():
    class _Placeholder(BaseHTTPException):
        code = 404

    with pytest.raises(ValueError, match="must declare an error_code: _Placeholder"):
        error_responses(_Placeholder)


class _SurfaceOnlyError(Exception):
    pass


def test_surface_specific_handlers_are_implicit_codes():
    api = ExternalApi(Blueprint("surface_handlers", __name__))
    api.document_error_handler(_SurfaceOnlyError, status=409, code="surface_conflict")

    document = _documented_operation(api, _ConflictError)

    # Handler-emitted codes stay generic: the contract check admits them, the document does not list them.
    assert _error_options(document, "409") == ["DocumentedConflictError"]
    assert api.implicit_error_codes(409) == {"conflict", "surface_conflict"}
    # The cached answer is a copy, and a later handler declaration refreshes it.
    api.implicit_error_codes(409).add("mutated")
    api.document_error_handler(_SurfaceOnlyError, status=409, code="surface_conflict_v2")
    assert api.implicit_error_codes(409) == {"conflict", "surface_conflict_v2"}


def test_error_components_are_shared_across_operations_and_carry_details():
    document: dict[str, object] = {
        "paths": {
            "/items": {
                "post": {"responses": {}, "x-dify-error-codes": _documented_names_for(_ConflictError)},
                "put": {"responses": {}, "x-dify-error-codes": _documented_names_for(_ConflictError)},
            }
        }
    }

    attach_error_response_schema(document, ErrorResponse, _resolve_by_class)

    component_ref = {"$ref": "#/components/schemas/DocumentedConflictError"}
    for method in ("post", "put"):
        response = document["paths"]["/items"][method]["responses"]["409"]  # type: ignore[index]
        # The open error body stays beside the component: a generic error can answer 409 too.
        assert response == {
            "description": "Conflict",
            "content": {"application/json": {"schema": {"anyOf": [component_ref, _ERROR_BODY_REF]}}},
        }
    schemas = document["components"]["schemas"]  # type: ignore[index]
    assert schemas["DocumentedConflictError"]["allOf"][1]["properties"]["details"] == {
        "$ref": "#/components/schemas/_ConflictDetails"
    }
    assert schemas["_ConflictDetails"]["required"] == ["server_hash"]


def test_error_responses_union_explicit_schema_with_documented_codes():
    explicit = {"application/json": {"schema": {"$ref": "#/components/schemas/Custom"}}}
    document: dict[str, object] = {
        "paths": {
            "/items": {
                "get": {
                    "responses": {"409": {"description": "Conflict", "content": explicit}},
                    "x-dify-error-codes": _documented_names_for(_ConflictError),
                }
            }
        }
    }

    attach_error_response_schema(document, ErrorResponse, _resolve_by_class)

    assert document["paths"]["/items"]["get"]["responses"]["409"]["content"] == {  # type: ignore[index]
        "application/json": {
            "schema": {
                "anyOf": [
                    {"$ref": "#/components/schemas/Custom"},
                    {"$ref": "#/components/schemas/DocumentedConflictError"},
                    _ERROR_BODY_REF,
                ]
            }
        }
    }


def test_documented_status_keeps_its_other_media_types():
    content = {
        "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
        "application/json": {"schema": {"$ref": "#/components/schemas/Custom"}, "example": {"error": "x"}},
    }
    document: dict[str, object] = {
        "paths": {
            "/items": {
                "get": {
                    "responses": {"409": {"description": "Conflict", "content": content}},
                    "x-dify-error-codes": _documented_names_for(_ConflictError),
                }
            }
        }
    }

    attach_error_response_schema(document, ErrorResponse, _resolve_by_class)

    assert document["paths"]["/items"]["get"]["responses"]["409"]["content"] == {  # type: ignore[index]
        "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
        "application/json": {
            "example": {"error": "x"},
            "schema": {
                "anyOf": [
                    {"$ref": "#/components/schemas/Custom"},
                    {"$ref": "#/components/schemas/DocumentedConflictError"},
                    _ERROR_BODY_REF,
                ]
            },
        },
    }


def test_details_model_definitions_must_not_collide_with_different_schemas():
    document: dict[str, object] = {
        "components": {"schemas": {"_ConflictDetails": {"type": "object", "properties": {"other": {}}}}},
        "paths": {"/items": {"get": {"responses": {}, "x-dify-error-codes": _documented_names_for(_ConflictError)}}},
    }

    with pytest.raises(ValueError, match="_ConflictDetails .*collides with a different component"):
        attach_error_response_schema(document, ErrorResponse, _resolve_by_class)


def test_error_component_names_must_not_collide():
    document: dict[str, object] = {
        "components": {"schemas": {"DocumentedConflictError": {"type": "object"}}},
        "paths": {"/items": {"get": {"responses": {}, "x-dify-error-codes": _documented_names_for(_ConflictError)}}},
    }

    with pytest.raises(ValueError, match="DocumentedConflictError .*collides"):
        attach_error_response_schema(document, ErrorResponse, _resolve_by_class)


class _ConflictAsBadRequest(BaseHTTPException):
    error_code = "documented_conflict"
    code = 400


class _ConflictWithoutDetails(BaseHTTPException):
    error_code = "documented_conflict"
    code = 409


def test_error_code_maps_to_one_status_per_document():
    document: dict[str, object] = {
        "paths": {
            "/items": {
                "get": {"responses": {}, "x-dify-error-codes": _documented_names_for(_ConflictError)},
                "post": {"responses": {}, "x-dify-error-codes": _documented_names_for(_ConflictAsBadRequest)},
            }
        }
    }

    with pytest.raises(ValueError, match="'documented_conflict' answers 400 on POST /items but 409 on GET /items"):
        attach_error_response_schema(document, ErrorResponse, _resolve_by_class)


def test_error_code_classes_must_agree_on_details():
    document: dict[str, object] = {
        "paths": {
            "/items": {
                "get": {
                    "responses": {},
                    "x-dify-error-codes": _documented_names_for(_ConflictError, _ConflictWithoutDetails),
                }
            }
        }
    }

    with pytest.raises(ValueError, match="'documented_conflict' declares different details models"):
        attach_error_response_schema(document, ErrorResponse, _resolve_by_class)


def test_resolves_errors_in_flask_restx_dispatch_order():
    """Flask-RESTX picks the first registered handler that matches, not the most specific one."""
    from core.errors.error import AppInvokeQuotaExceededError

    api = ExternalApi(Blueprint("dispatch_order", __name__))

    # ValueError is registered before AppInvokeQuotaExceededError (a ValueError), so it wins.
    assert api.resolve_error(AppInvokeQuotaExceededError) == (400, "invalid_param")
    assert api.resolve_error(_DocumentedError) == (400, "documented_error")


def test_framework_error_subclasses_are_implicit_codes():
    from flask import request

    app = Flask(__name__)
    blueprint = Blueprint("missing_upload", __name__)
    api = ExternalApi(blueprint)

    @api.route("/upload")
    class Upload(Resource):
        def post(self):
            request.files["pkg"]  # a missing field raises BadRequestKeyError
            return {}

    app.register_blueprint(blueprint)
    response = app.test_client().post("/upload", data={})

    body = response.get_json()
    assert response.status_code == 400
    assert body["code"] == "bad_request_key_error"
    assert body["code"] in api.implicit_error_codes(400)


def test_relayed_http_error_emits_the_standard_body_with_runtime_code_and_status():
    from libs.exception import RelayedHTTPError

    error = RelayedHTTPError(status=409, error_code="downstream_conflict", message="busy", details={"retry": 3})

    assert error.code == 409
    assert error.data == {"code": "downstream_conflict", "message": "busy", "status": 409, "details": {"retry": 3}}


def test_documenting_relayed_errors_adds_nothing_beyond_the_default_error():
    from libs.exception import RelayedHTTPError

    error_responses(RelayedHTTPError)  # accepted although its class keeps the placeholder code
    document: dict[str, object] = {
        "paths": {
            "/items": {
                "post": {
                    "responses": {"400": {"description": "Bad"}},
                    "x-dify-error-codes": _documented_names_for(_ConflictError, RelayedHTTPError),
                }
            }
        }
    }

    attach_error_response_schema(document, ErrorResponse, _resolve_by_class)

    operation = document["paths"]["/items"]["post"]  # type: ignore[index]
    responses = operation["responses"]
    assert responses["400"]["content"] == {"application/json": {"schema": _ERROR_BODY_REF}}
    assert responses["default"]["content"] == {"application/json": {"schema": _ERROR_BODY_REF}}
    assert responses["409"]["content"]["application/json"]["schema"] == {
        "anyOf": [{"$ref": "#/components/schemas/DocumentedConflictError"}, _ERROR_BODY_REF]
    }
    assert operation["x-dify-relays-errors"] is True


def test_keeps_placeholder_error_code_spots_undeclared_business_errors():
    from libs.exception import RelayedHTTPError

    class _Placeholder(BaseHTTPException):
        code = 404

    assert keeps_placeholder_error_code(_Placeholder)
    assert not keeps_placeholder_error_code(_ItemMissingError)
    assert not keeps_placeholder_error_code(RelayedHTTPError)
    assert not keeps_placeholder_error_code(NotFound)


class _BootstrapMissingError(BaseHTTPException):
    error_code = "bootstrap_missing"
    description = "Bootstrap has not run."
    code = 401


def test_generic_errors_are_implicit_codes_and_never_listed():
    api = ExternalApi(Blueprint("generic_errors", __name__))
    api.document_generic_errors(_BootstrapMissingError)

    document = _documented_operation(api, _BootstrapMissingError, _DocumentedError)

    assert api.is_generic_error(_BootstrapMissingError)
    assert not api.is_generic_error(_DocumentedError)
    assert "bootstrap_missing" in api.implicit_error_codes(401)
    assert "bootstrap_missing" not in api.implicit_error_codes(400)
    # The operation keeps its real business errors and documents nothing for the generic one.
    assert _error_options(document, "400") == ["DocumentedError"]
    assert "BootstrapMissingError" not in document["components"]["schemas"]
    assert _error_options(document, "401") == ["WrapperDeniedError"]


@pytest.mark.parametrize("exception", [ValueError, NotFound])
def test_document_generic_errors_takes_business_shaped_errors_only(exception: type[Exception]):
    api = ExternalApi(Blueprint("generic_shape", __name__))

    with pytest.raises(ValueError, match="generic already"):
        api.document_generic_errors(exception)


def test_document_generic_errors_requires_an_error_code():
    class _Placeholder(BaseHTTPException):
        code = 401

    api = ExternalApi(Blueprint("generic_placeholder", __name__))

    with pytest.raises(ValueError, match="must declare an error_code"):
        api.document_generic_errors(_Placeholder)
