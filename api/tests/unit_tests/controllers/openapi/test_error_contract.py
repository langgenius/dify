"""Wire-contract tests for the canonical /openapi/v1 error body."""

from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import (
    BadGateway,
    BadRequest,
    Conflict,
    Forbidden,
    InternalServerError,
    NotFound,
    TooManyRequests,
    Unauthorized,
    UnprocessableEntity,
)

from controllers.common.errors import (
    BlockedFileExtensionError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.openapi._errors import (
    ErrorBody,
    ErrorDetail,
    FilenameNotExists,
    HumanInputFormNotFound,
    MemberLicenseExceeded,
    MemberLimitExceeded,
    OpenApiError,
    OpenApiErrorCode,
    OpenApiErrorFormatter,
    RecipientSurfaceMismatch,
    SessionExpired,
)
from controllers.service_api.app.error import (
    AgentNotPublishedError,
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError


@pytest.fixture
def fmt() -> OpenApiErrorFormatter:
    return OpenApiErrorFormatter()


class TestErrorBodyModel:
    def test_minimal_body_serializes_without_optional_fields(self):
        body = ErrorBody(code=OpenApiErrorCode.NOT_FOUND, message="app not found", status=404)

        wire = body.model_dump(mode="json", exclude_none=True)

        assert wire == {"code": "not_found", "message": "app not found", "status": 404}

    def test_full_body_round_trips(self):
        body = ErrorBody(
            code=OpenApiErrorCode.INVALID_PARAM,
            message="Request validation failed",
            status=422,
            hint="check the request payload",
            details=[ErrorDetail(type="int_parsing", loc=["page"], msg="must be >= 1")],
        )

        wire = body.model_dump(mode="json", exclude_none=True)

        assert wire["details"] == [{"type": "int_parsing", "loc": ["page"], "msg": "must be >= 1"}]
        assert ErrorBody.model_validate(wire) == body

    def test_code_field_is_open_string_for_forward_compat(self):
        # Old CLIs must not hard-fail when a future server adds a code, so the
        # schema type is str; enum membership is enforced by the formatter tests.
        body = ErrorBody.model_validate({"code": "some_future_code", "message": "x", "status": 400})

        assert body.code == "some_future_code"


class TestOpenApiErrorFormatter:
    def test_plain_werkzeug_exception_maps_code_from_status(self, fmt):
        e = NotFound("app not found")
        data = {"code": "not_found", "message": "app not found", "status": 404}

        wire = fmt.finalize(e, data, 404)

        assert wire == {"code": "not_found", "message": "app not found", "status": 404}

    def test_422_maps_to_invalid_param(self, fmt):
        e = UnprocessableEntity("workspace_id is required for name-based lookup")
        data = {"code": "unprocessable_entity", "message": e.description, "status": 422}

        wire = fmt.finalize(e, data, 422)

        assert wire["code"] == "invalid_param"

    def test_flask_restx_abort_data_path_yields_canonical_body(self, fmt):
        # Simulates _contract.py's abort(422, message=..., errors=...): flask_restx
        # attaches kwargs to e.data, which handle_error would otherwise put on the
        # wire verbatim (no code/status).
        e = UnprocessableEntity()
        e.data = {
            "message": "Request validation failed",
            "errors": [{"type": "int_parsing", "loc": ["page"], "msg": "must be >= 1", "extra": "drop me"}],
        }
        data = {"code": "unprocessable_entity", "message": e.description, "status": 422}

        wire = fmt.finalize(e, data, 422)

        assert wire["code"] == "invalid_param"
        assert wire["message"] == "Request validation failed"
        assert wire["status"] == 422
        assert wire["details"] == [{"type": "int_parsing", "loc": ["page"], "msg": "must be >= 1"}]
        # the override channel now carries the canonical body
        assert e.data == wire

    def test_finalize_is_idempotent(self, fmt):
        e = UnprocessableEntity()
        e.data = {
            "message": "Request validation failed",
            "errors": [{"type": "int_parsing", "loc": ["page"], "msg": "must be >= 1"}],
        }
        data = {"code": "unprocessable_entity", "message": e.description, "status": 422}

        first = fmt.finalize(e, data, 422)
        second = fmt.finalize(e, data, 422)

        assert second == first

    def test_malformed_canonical_details_falls_back_instead_of_raising(self, fmt):
        # finalize runs inside the framework error handler; a ValidationError
        # escaping it would replace the response with an unformatted 500
        e = UnprocessableEntity()
        e.data = {"message": "broken", "details": [{"bad": "shape"}]}
        data = {"code": "unprocessable_entity", "message": "broken", "status": 422}

        wire = fmt.finalize(e, data, 422)

        assert wire == {"code": "invalid_param", "message": "Unprocessable Entity", "status": 422}

    def test_base_http_exception_error_code_wins_over_status_map(self, fmt):
        e = ProviderQuotaExceededError()
        data = dict(e.data)

        wire = fmt.finalize(e, data, 400)

        assert wire["code"] == "provider_quota_exceeded"
        assert wire["status"] == 400

    def test_hint_attribute_is_emitted(self, fmt):
        e = Conflict("seat limit")
        e.hint = "remove a member first"
        data = {"code": "conflict", "message": "seat limit", "status": 409}

        wire = fmt.finalize(e, data, 409)

        assert wire["hint"] == "remove a member first"

    def test_params_shape_becomes_details(self, fmt):
        e = ValueError("is required")
        data = {"code": "invalid_param", "message": "is required", "params": "email", "status": 400}

        wire = fmt.finalize(e, data, 400)

        assert "params" not in wire
        assert wire["details"] == [{"type": "invalid", "loc": ["email"], "msg": "is required"}]

    def test_catch_all_exception_never_leaks_str_e(self, fmt):
        e = RuntimeError("postgres password=hunter2 connection refused")
        data = {"message": str(e), "code": "unknown", "status": 500}

        wire = fmt.finalize(e, data, 500)

        assert wire["code"] == "internal_server_error"
        assert "hunter2" not in wire["message"]

    def test_unmapped_status_falls_back_to_unknown(self, fmt):
        from werkzeug.exceptions import Gone

        e = Gone()
        data = {"code": "gone", "message": e.description, "status": 410}

        wire = fmt.finalize(e, data, 410)

        assert wire["code"] == "unknown"

    def test_openapi_error_subclass_is_throw_and_done(self, fmt):
        # The dedicated throwable: subclass declares status + code + message once,
        # call sites just `raise`; the formatter emits everything verbatim.
        class TeapotError(OpenApiError):
            code = 418
            error_code = OpenApiErrorCode.INVALID_PARAM
            description = "kettle says no"

        e = TeapotError(details=[ErrorDetail(type="invalid", loc=["kettle"], msg="too hot")])
        data = {"code": "im_a_teapot", "message": e.description, "status": 418}

        wire = fmt.finalize(e, data, 418)

        assert wire["code"] == OpenApiErrorCode.INVALID_PARAM
        assert wire["message"] == TeapotError.description
        assert wire["details"] == [{"type": "invalid", "loc": ["kettle"], "msg": "too hot"}]

    def test_openapi_error_message_override(self, fmt):
        e = OpenApiError("custom reason")
        data = {"code": "bad_request", "message": e.description, "status": 400}

        wire = fmt.finalize(e, data, 400)

        assert wire["message"] == "custom reason"
        assert wire["code"] == "bad_request"

    def test_every_emitted_code_is_an_enum_member(self, fmt):
        # Guard against the formatter inventing codes outside the contract.
        cases = [
            (NotFound("x"), {"code": "not_found", "message": "x", "status": 404}, 404),
            (ProviderQuotaExceededError(), dict(ProviderQuotaExceededError().data), 400),
            (ValueError("x"), {"code": "invalid_param", "message": "x", "status": 400}, 400),
        ]
        for e, data, status in cases:
            wire = fmt.finalize(e, data, status)
            assert wire["code"] in {c.value for c in OpenApiErrorCode}


class TestQuotaExceptions:
    @pytest.mark.parametrize("exc_class", [MemberLimitExceeded, MemberLicenseExceeded])
    def test_quota_exception_carries_declared_code_and_message(self, fmt, exc_class):
        # Single source: assertions read the class attributes, no re-typed strings.
        e = exc_class()
        data = {"code": "forbidden", "message": e.description, "status": 403}

        wire = fmt.finalize(e, data, 403)

        assert wire["code"] == exc_class.error_code
        assert wire["message"] == exc_class.description
        assert wire["hint"] == exc_class.hint
        assert wire["status"] == 403


class TestWireContract:
    """End-to-end: request in, canonical JSON out, through the real openapi blueprint."""

    def test_accepts_422_carries_code_status_details(self, openapi_app, bypass_pipeline):
        client = openapi_app.test_client()

        resp = client.get("/openapi/v1/apps?page=0")

        assert resp.status_code == 422
        wire = resp.get_json()
        ErrorBody.model_validate(wire)
        assert wire["code"] == "invalid_param"
        assert wire["status"] == 422
        assert wire["details"]

    def test_unknown_route_404_is_canonical_without_route_suggestions(self, openapi_app):
        client = openapi_app.test_client()

        resp = client.get("/openapi/v1/definitely-not-a-route")

        assert resp.status_code == 404
        wire = resp.get_json()
        ErrorBody.model_validate(wire)
        assert wire["code"] == "not_found"
        assert "did you mean" not in wire["message"].lower()

    def test_404_outside_blueprint_prefix_is_not_claimed(self, openapi_app):
        # catch_all_404s wraps the app-level exception handler; the prefix
        # guard must keep non-/openapi/v1 paths on the app's own 404 handling
        client = openapi_app.test_client()

        resp = client.get("/console/definitely-not-a-route")

        assert resp.status_code == 404
        # not intercepted → Flask's default HTML 404, not the canonical JSON body
        assert "application/json" not in (resp.content_type or "")

    @patch("controllers.openapi.oauth_device.DeviceFlowRedis")
    def test_oauth_device_token_keeps_rfc8628_shape(self, mock_redis_cls, openapi_app):
        store = MagicMock()
        mock_redis_cls.return_value = store
        store.record_poll.return_value = None  # not SlowDownDecision.SLOW_DOWN
        store.load_by_device_code.return_value = None  # unknown code → expired_token

        client = openapi_app.test_client()

        resp = client.post(
            "/openapi/v1/oauth/device/token",
            json={"client_id": "difyctl", "device_code": "nope"},
        )

        assert resp.status_code == 400
        wire = resp.get_json()
        assert wire == {"error": "expired_token"}


ERROR_MATRIX = [
    (BadRequest("x"), 400, "bad_request"),
    (Unauthorized("x"), 401, "unauthorized"),
    (Forbidden("x"), 403, "forbidden"),
    (NotFound("x"), 404, "not_found"),
    (Conflict("x"), 409, "conflict"),
    (UnprocessableEntity("x"), 422, "invalid_param"),
    (InternalServerError(), 500, "internal_server_error"),
    (BadGateway("x"), 502, "bad_gateway"),
    (AppUnavailableError(), 400, "app_unavailable"),
    (AgentNotPublishedError(), 400, "agent_not_published"),
    (ConversationCompletedError(), 400, "conversation_completed"),
    (ProviderNotInitializeError(), 400, "provider_not_initialize"),
    (ProviderQuotaExceededError(), 400, "provider_quota_exceeded"),
    (ProviderModelCurrentlyNotSupportError(), 400, "model_currently_not_support"),
    (CompletionRequestError(), 400, "completion_request_error"),
    (InvokeRateLimitHttpError(), 429, "rate_limit_error"),
    (TooManyRequests("x"), 429, "too_many_requests"),  # difyctl's classifyRateLimit keys retryability on this code
    (FileTooLargeError(), 413, "file_too_large"),
    (UnsupportedFileTypeError(), 415, "unsupported_file_type"),
    (NoFileUploadedError(), 400, "no_file_uploaded"),
    (TooManyFilesError(), 400, "too_many_files"),
    (FilenameNotExists(), 400, "filename_not_exists"),
    (BlockedFileExtensionError(), 400, "file_extension_blocked"),
    (MemberLimitExceeded(), 403, "member_limit_exceeded"),
    (MemberLicenseExceeded(), 403, "member_license_exceeded"),
    (HumanInputFormNotFound(), 404, "form_not_found"),
    (RecipientSurfaceMismatch(), 403, "recipient_surface_mismatch"),
]


class TestErrorMatrix:
    @pytest.mark.parametrize(
        ("exc", "status", "expected_code"),
        ERROR_MATRIX,
        ids=lambda v: type(v).__name__ if isinstance(v, Exception) else str(v),
    )
    def test_every_known_error_path_yields_canonical_code(self, fmt, exc, status, expected_code):
        data = dict(getattr(exc, "data", None) or {"message": str(exc), "status": status})

        wire = fmt.finalize(exc, data, status)

        assert wire["code"] == expected_code
        assert wire["status"] == status
        assert wire["code"] in {c.value for c in OpenApiErrorCode}
        ErrorBody.model_validate(wire)


class TestErrorCodeEnumRegistration:
    def test_enum_registered_with_all_values(self):
        from controllers.openapi import openapi_ns
        from controllers.openapi._errors import OpenApiErrorCode

        model = openapi_ns.models.get("OpenApiErrorCode")
        assert model is not None
        schema = model.__schema__
        assert schema["type"] == "string"
        assert set(schema["enum"]) == {member.value for member in OpenApiErrorCode}


class TestSessionExpired:
    def test_session_expired_emits_token_expired_401_with_hint(self):
        fmt = OpenApiErrorFormatter()
        e = SessionExpired()
        data = {"code": "unauthorized", "message": e.description, "status": 401}

        wire = fmt.finalize(e, data, 401)

        assert wire["code"] == OpenApiErrorCode.TOKEN_EXPIRED
        assert wire["status"] == 401
        assert wire["hint"]

    def test_session_expired_code_is_401(self):
        assert SessionExpired.code == 401
        assert SessionExpired.error_code == OpenApiErrorCode.TOKEN_EXPIRED
